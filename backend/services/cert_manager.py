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
        """Executes ACME Let's Encrypt certificate renewal via Certbot CLI."""
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

        _info(f"Starting ACME Let's Encrypt renewal for domain '{domain}' (challenge: {challenge_type})...")

        # Check if certbot CLI is available
        certbot_bin = subprocess.run(["which", "certbot"], capture_output=True, text=True).stdout.strip()
        if not certbot_bin:
            msg = "Certbot utility is not installed on this server. Please install certbot (e.g. 'sudo apt install certbot') or use Custom Certificate Upload."
            _err(msg)
            return False, msg

        _info(f"Using certbot CLI binary at {certbot_bin}...")
        cmd = [
            certbot_bin, "certonly", "--standalone", "--non-interactive", "--agree-tos",
            "-m", email, "-d", domain, "--cert-name", "ffmpeg-gui", "--http-01-port", "80"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            _info("Certbot renewal succeeded. Copying live certificates to SSOT...")
            live_cert = f"/etc/letsencrypt/live/ffmpeg-gui/fullchain.pem"
            live_key = f"/etc/letsencrypt/live/ffmpeg-gui/privkey.pem"
            if os.path.exists(live_cert) and os.path.exists(live_key):
                with open(live_cert, "rb") as f_c, open(live_key, "rb") as f_k:
                    self.save_custom_cert(f_c.read(), f_k.read(), mode="acme")
                _info("Certificates successfully imported into FFmpeg-GUI live storage.")
                return True, f"Certificate for '{domain}' successfully renewed and imported via Certbot."
            else:
                msg = f"Certbot completed but certificate files were not found at {live_cert}."
                _err(msg)
                return False, msg
        else:
            err_output = res.stderr.strip() or res.stdout.strip() or "Unknown error"
            msg = f"Certbot execution failed: {err_output}"
            _err(msg)
            return False, msg

    def on_cert_renewed(self):
        """Hook triggered after certificate update to notify downstream services."""
        logger.info("SSL Certificate updated. Dispatched on_cert_renewed event hook.")
