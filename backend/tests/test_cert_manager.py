import os
import shutil
import tempfile
import unittest
import subprocess
from backend.services.cert_manager import CertificateManager

class TestCertificateManager(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.cert_manager = CertificateManager(certs_dir=self.test_dir)
        
        # Generate temporary self-signed test cert & key with OpenSSL
        self.cert_path = os.path.join(self.test_dir, "test_gen_cert.pem")
        self.key_path = os.path.join(self.test_dir, "test_gen_key.pem")
        
        cmd = [
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", self.key_path, "-out", self.cert_path,
            "-days", "90", "-nodes", "-subj", "/CN=stream.ffmpeg-gui.test"
        ]
        subprocess.run(cmd, capture_output=True, check=True)

        with open(self.cert_path, "rb") as f:
            self.cert_bytes = f.read()
        with open(self.key_path, "rb") as f:
            self.key_bytes = f.read()

    def tearDown(self):
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir)

    def test_missing_cert_status(self):
        status = self.cert_manager.get_cert_status()
        self.assertEqual(status["status"], "missing")
        self.assertFalse(status["valid"])
        self.assertEqual(status["days_remaining"], 0)

    def test_validate_keypair_success(self):
        is_valid, err = self.cert_manager.validate_keypair(self.cert_bytes, self.key_bytes)
        self.assertTrue(is_valid)
        self.assertIsNone(err)

    def test_validate_keypair_mismatch(self):
        # Generate a second key that does not match
        other_key_path = os.path.join(self.test_dir, "other_key.pem")
        cmd = ["openssl", "genrsa", "-out", other_key_path, "2048"]
        subprocess.run(cmd, capture_output=True, check=True)
        with open(other_key_path, "rb") as f:
            mismatched_key_bytes = f.read()

        is_valid, err = self.cert_manager.validate_keypair(self.cert_bytes, mismatched_key_bytes)
        self.assertFalse(is_valid)
        self.assertIn("mismatch", err)

    def test_save_and_get_status_valid(self):
        success, err = self.cert_manager.save_custom_cert(self.cert_bytes, self.key_bytes, mode="custom")
        self.assertTrue(success)
        self.assertIsNone(err)

        status = self.cert_manager.get_cert_status()
        self.assertEqual(status["status"], "valid")
        self.assertTrue(status["valid"])
        self.assertGreater(status["days_remaining"], 80)
        self.assertEqual(status["domain"], "stream.ffmpeg-gui.test")
        self.assertEqual(status["mode"], "custom")

if __name__ == "__main__":
    unittest.main()
