import os
import json
import ssl
import datetime
import subprocess
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("ffmpeg_gui.cert_manager")

DEFAULT_CERTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data/certs/live"))

class CertificateManager:
    def __init__(self, certs_dir: Optional[str] = None):
        self.certs_dir = certs_dir or DEFAULT_CERTS_DIR
        self.fullchain_path = os.path.join(self.certs_dir, "fullchain.pem")
        self.privkey_path = os.path.join(self.certs_dir, "privkey.pem")
        self.metadata_path = os.path.join(self.certs_dir, "metadata.json")
        self._ensure_dir()

    def _ensure_dir(self):
        os.makedirs(self.certs_dir, mode=0o700, exist_ok=True)

    def get_cert_status(self) -> Dict[str, Any]:
        """Evaluates active certificate status in self.certs_dir."""
        if not os.path.exists(self.fullchain_path) or not os.path.exists(self.privkey_path):
            return {
                "status": "missing",
                "valid": False,
                "days_remaining": 0,
                "domain": None,
                "issuer": None,
                "expires_at": None,
                "mode": "disabled",
                "error": "No SSL certificate or private key found in storage."
            }

        try:
            # Parse cert details using openssl or ssl module
            cmd = ["openssl", "x509", "-in", self.fullchain_path, "-noout", "-dates", "-subject", "-issuer"]
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            output = res.stdout

            details = {}
            for line in output.splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    details[k.strip().lower()] = v.strip()

            not_after_str = details.get("notafter")
            subject_str = details.get("subject", "")
            issuer_str = details.get("issuer", "")

            # Extract CN or domain from subject
            domain = None
            if "CN" in subject_str:
                for part in subject_str.split("/"):
                    if part.startswith("CN=") or part.startswith("CN ="):
                        domain = part.split("=", 1)[1].strip()
                        break

            # Parse expiration date
            # OpenSSL notAfter format e.g. "Jul 24 12:00:00 2026 GMT"
            expires_at_dt = None
            if not_after_str:
                try:
                    expires_at_dt = datetime.datetime.strptime(not_after_str, "%b %d %H:%M:%S %Y GMT").replace(tzinfo=datetime.timezone.utc)
                except ValueError:
                    pass

            if not expires_at_dt:
                # Fallback via ssl module
                cert_dict = ssl._ssl._test_decode_cert(self.fullchain_path)
                not_after_str = cert_dict.get("notAfter")
                if not_after_str:
                    expires_at_dt = datetime.datetime.strptime(not_after_str, "%b %d %H:%M:%S %Y GMT").replace(tzinfo=datetime.timezone.utc)

            now_dt = datetime.datetime.now(datetime.timezone.utc)
            if expires_at_dt:
                days_remaining = (expires_at_dt - now_dt).days
                expires_at_iso = expires_at_dt.isoformat()
            else:
                days_remaining = 0
                expires_at_iso = None

            # Determine status badge
            if days_remaining <= 0:
                status_code = "expired"
                is_valid = False
            elif days_remaining < 15:
                status_code = "critical"
                is_valid = True
            elif days_remaining <= 30:
                status_code = "warning"
                is_valid = True
            else:
                status_code = "valid"
                is_valid = True

            # Read mode from metadata if present
            mode = "custom"
            if os.path.exists(self.metadata_path):
                try:
                    with open(self.metadata_path, "r") as f:
                        meta = json.load(f)
                        mode = meta.get("mode", "custom")
                except Exception:
                    pass

            return {
                "status": status_code,
                "valid": is_valid,
                "days_remaining": days_remaining,
                "domain": domain or "localhost",
                "issuer": issuer_str or "Unknown",
                "expires_at": expires_at_iso,
                "mode": mode,
                "error": None
            }
        except Exception as e:
            logger.error(f"Error parsing SSL certificate status: {e}")
            return {
                "status": "error",
                "valid": False,
                "days_remaining": 0,
                "domain": None,
                "issuer": None,
                "expires_at": None,
                "mode": "disabled",
                "error": f"Failed to parse SSL certificate: {str(e)}"
            }

    def validate_keypair(self, cert_pem_bytes: bytes, key_pem_bytes: bytes) -> Tuple[bool, Optional[str]]:
        """Verifies cryptographic matching of certificate and private key."""
        tmp_cert = os.path.join(self.certs_dir, ".tmp_cert.pem")
        tmp_key = os.path.join(self.certs_dir, ".tmp_key.pem")

        try:
            with open(tmp_cert, "wb") as f:
                f.write(cert_pem_bytes)
            with open(tmp_key, "wb") as f:
                f.write(key_pem_bytes)

            # Check cert validity
            cmd_cert = ["openssl", "x509", "-in", tmp_cert, "-noout", "-modulus"]
            res_cert = subprocess.run(cmd_cert, capture_output=True, text=True)
            if res_cert.returncode != 0:
                return False, f"Invalid certificate format: {res_cert.stderr.strip()}"

            # Check key validity
            cmd_key = ["openssl", "pkey", "-in", tmp_key, "-noout", "-modulus"]
            res_key = subprocess.run(cmd_key, capture_output=True, text=True)
            if res_key.returncode != 0:
                # Fallback for RSA specific keys
                cmd_key = ["openssl", "rsa", "-in", tmp_key, "-noout", "-modulus"]
                res_key = subprocess.run(cmd_key, capture_output=True, text=True)
                if res_key.returncode != 0:
                    return False, f"Invalid private key format: {res_key.stderr.strip()}"

            mod_cert = res_cert.stdout.strip()
            mod_key = res_key.stdout.strip()

            if mod_cert != mod_key:
                return False, "Certificate and private key do not match (modulus mismatch)."

            return True, None
        except Exception as e:
            return False, f"Error validating keypair: {str(e)}"
        finally:
            if os.path.exists(tmp_cert):
                try: os.remove(tmp_cert)
                except Exception: pass
            if os.path.exists(tmp_key):
                try: os.remove(tmp_key)
                except Exception: pass

    def save_custom_cert(self, cert_pem_bytes: bytes, key_pem_bytes: bytes, mode: str = "custom") -> Tuple[bool, Optional[str]]:
        """Validates and saves custom certificate and key to live SSOT storage."""
        is_valid, err = self.validate_keypair(cert_pem_bytes, key_pem_bytes)
        if not is_valid:
            return False, err

        try:
            with open(self.fullchain_path, "wb") as f:
                f.write(cert_pem_bytes)
            os.chmod(self.fullchain_path, 0o644)

            with open(self.privkey_path, "wb") as f:
                f.write(key_pem_bytes)
            os.chmod(self.privkey_path, 0o600)

            metadata = {
                "mode": mode,
                "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
            with open(self.metadata_path, "w") as f:
                json.dump(metadata, f, indent=2)

            self.on_cert_renewed()
            return True, None
        except Exception as e:
            return False, f"Failed to save certificate files: {str(e)}"

    def renew_acme_certificate(self, domain: str, email: str, challenge_type: str = "http-01", log_info=None, log_error=None) -> Tuple[bool, str]:
        """Executes ACME Let's Encrypt certificate renewal via pure Python `acme` library."""
        def _info(msg: str):
            if log_info: log_info(msg)
            logger.info(msg)

        def _err(msg: str):
            if log_error: log_error(msg)
            logger.error(msg)

        if not domain or domain == "localhost" or not email:
            msg = "A valid public Domain Name (FQDN) and ACME contact email are required for Let's Encrypt renewal."
            _err(msg)
            return False, msg

        _info(f"Starting ACME Let's Encrypt renewal for domain '{domain}' via pure Python ACME v2 client...")

        try:
            import josepy as jose
            from acme import client as acme_client
            from acme import messages, crypto_util
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric import rsa

            # 1. Generate ACME Account Private Key
            account_key = jose.JWKRSA(key=rsa.generate_private_key(public_exponent=65537, key_size=2048))

            # 2. Network Client Session
            net = acme_client.ClientNetwork(account_key, user_agent="FFmpeg-GUI-ACME/1.29.0")
            directory_url = "https://acme-v02.api.letsencrypt.org/directory"
            directory = acme_client.ClientV2.get_directory(directory_url, net)
            acme_c = acme_client.ClientV2(directory, net=net)

            # 3. Register Account with Let's Encrypt
            _info("Registering ACME account with Let's Encrypt...")
            acme_c.new_account(messages.NewRegistration.from_data(email=email, terms_of_service_agreed=True))

            # 4. Create Order
            _info(f"Creating ACME certificate order for '{domain}'...")
            order = acme_c.new_order(messages.NewOrder.from_data(identifiers=[messages.Identifier(type=messages.IDENTIFIER_TYPES['dns'], value=domain)]))

            # 5. Extract HTTP-01 Challenge
            authz = order.authorizations[0]
            http_challenge = None
            for chall_body in authz.body.challenges:
                if isinstance(chall_body.chall, messages.HTTP01):
                    http_challenge = chall_body
                    break

            if not http_challenge:
                msg = "Let's Encrypt server did not offer an HTTP-01 challenge."
                _err(msg)
                return False, msg

            response, validation = http_challenge.response_and_validation(account_key)
            token = http_challenge.chall.token

            # Register token in main app ACME_CHALLENGES dictionary
            try:
                from main import ACME_CHALLENGES
                ACME_CHALLENGES[token] = validation
                _info(f"Registered HTTP-01 token challenge for '{token}'...")
            except Exception as e:
                _info(f"Challenge token setup: {e}")

            # 6. Answer Challenge
            _info("Answering ACME HTTP-01 challenge...")
            acme_c.answer_challenge(http_challenge, response)

            # 7. Poll Order Finalization
            _info("Polling ACME challenge validation status...")
            finalized_order = acme_c.poll_and_finalize(order)

            # 8. Generate Domain Key & CSR
            _info("Generating RSA 2048 domain private key and CSR...")
            domain_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            csr_pem = crypto_util.make_csr(
                domain_key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.TraditionalOpenSSL,
                    encryption_algorithm=serialization.NoEncryption()
                ),
                [domain]
            )

            # 9. Request Certificate Issuance
            _info("Requesting final certificate issuance from Let's Encrypt...")
            final_order = acme_c.finalize_order(finalized_order, csr_pem)

            cert_pem_bytes = final_order.fullchain_pem.encode("utf-8")
            key_pem_bytes = domain_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            )

            # Save certificate & private key to SSOT storage
            saved, save_err = self.save_custom_cert(cert_pem_bytes, key_pem_bytes, mode="acme")
            if not saved:
                _err(f"Failed to save issued certificate: {save_err}")
                return False, f"Failed to save certificate: {save_err}"

            # Clean token
            try:
                from main import ACME_CHALLENGES
                ACME_CHALLENGES.pop(token, None)
            except Exception:
                pass

            _info(f"Certificate for '{domain}' successfully issued and saved!")
            return True, f"Certificate for '{domain}' successfully issued and imported via Let's Encrypt."

        except Exception as e:
            err_msg = f"Pure Python ACME protocol error: {str(e)}"
            _err(err_msg)
            return False, err_msg

    def on_cert_renewed(self):
        """Hook triggered after certificate update to notify downstream services."""
        logger.info("SSL Certificate updated. Dispatched on_cert_renewed event hook.")
