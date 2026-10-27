import os
import unittest
import tempfile
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from backend.database.db import SessionLocal, init_db
from backend.database.models import AuditLog
from backend.core.audit_logger import (
    AuditLogger,
    calculate_dict_delta,
    mask_sensitive_value,
)
from backend.main import app


class TestAuditLogger(unittest.TestCase):

    def setUp(self):
        init_db()
        self.tmp_log = tempfile.NamedTemporaryFile(delete=False, suffix=".log")
        self.tmp_log.close()
        os.environ["AUDIT_LOG_PATH"] = self.tmp_log.name
        self.logger = AuditLogger()
        self.logger._audit_log_path = self.tmp_log.name
        self.client = TestClient(app)

    def tearDown(self):
        if os.path.exists(self.tmp_log.name):
            try:
                os.remove(self.tmp_log.name)
            except OSError:
                pass

    def test_mask_sensitive_value(self):
        self.assertEqual(mask_sensitive_value("gui_password", "supersecret"), "***")
        self.assertEqual(mask_sensitive_value("tunnel_secret", "abc-123"), "***")
        self.assertEqual(mask_sensitive_value("bitrate", "5000k"), "5000k")

    def test_calculate_dict_delta(self):
        old_cfg = {
            "name": "Canal 1",
            "bitrate": "2500k",
            "gui_password": "old_password",
            "fps": 30,
            "created_at": "2026-01-01",
        }
        new_cfg = {
            "name": "Canal 1 Principal",
            "bitrate": "5000k",
            "gui_password": "new_password",
            "fps": 30,
            "created_at": "2026-02-02",
        }
        summary, delta = calculate_dict_delta(old_cfg, new_cfg)
        self.assertIn("bitrate: \"2500k\" -> \"5000k\"", summary)
        self.assertIn("name: \"Canal 1\" -> \"Canal 1 Principal\"", summary)
        self.assertIn("gui_password: \"***\" -> \"***\"", summary)
        # created_at should be ignored
        self.assertNotIn("created_at", delta)
        # fps did not change
        self.assertNotIn("fps", delta)

    def test_dual_write_disk_and_db(self):
        entry = self.logger.log(
            action="SERVICE_UPDATE",
            target_type="service",
            target_id=42,
            target_name="Test HLS",
            channel="local_gui",
            username="admin",
            ip_address="192.168.1.100",
            changes="bitrate: 2500k -> 5000k",
            details="Updated by operator",
        )

        # 1. Check disk file
        with open(self.tmp_log.name, "r", encoding="utf-8") as f:
            lines = f.readlines()
        self.assertGreater(len(lines), 0)
        last_line = lines[-1].strip()
        self.assertIn("[LOCAL_GUI]", last_line)
        self.assertIn("admin", last_line)
        self.assertIn("SERVICE_UPDATE service#42", last_line)
        self.assertIn("bitrate: 2500k -> 5000k", last_line)

        # 2. Check DB
        with SessionLocal() as db:
            db_record = db.query(AuditLog).filter(AuditLog.id == entry.id).first()
            self.assertIsNotNone(db_record)
            self.assertEqual(db_record.action, "SERVICE_UPDATE")
            self.assertEqual(db_record.target_id, "42")
            self.assertEqual(db_record.target_name, "Test HLS")
            self.assertEqual(db_record.channel, "local_gui")
            self.assertEqual(db_record.username, "admin")
            self.assertEqual(db_record.ip_address, "192.168.1.100")

    def test_extract_actor_cloudhub_vs_local(self):
        mock_req_cloudhub = MagicMock()
        mock_req_cloudhub.headers = {
            "x-authenticated-channel": "cloudhub",
            "x-authenticated-user": "carlos_support",
        }
        info_ch = self.logger.extract_actor_info(mock_req_cloudhub)
        self.assertEqual(info_ch["channel"], "cloudhub")
        self.assertEqual(info_ch["username"], "carlos_support")

        mock_req_local = MagicMock()
        mock_req_local.headers = {}
        mock_req_local.client.host = "10.0.0.50"
        info_local = self.logger.extract_actor_info(mock_req_local)
        self.assertEqual(info_local["channel"], "local_gui")
        self.assertEqual(info_local["username"], "admin")
        self.assertEqual(info_local["ip_address"], "10.0.0.50")

    def test_api_audit_logs_query(self):
        self.logger.log(
            action="SERVICE_START",
            target_type="service",
            target_id=99,
            target_name="Canal 99",
            channel="cloudhub",
            username="operator_diego",
            ip_address="cloudhub-tunnel",
            details="Remote start",
        )

        # Query via FastAPI TestClient
        resp = self.client.get("/api/audit-logs?action=SERVICE_START&limit=10")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("logs", data)
        self.assertGreater(data["total"], 0)
        matching = [l for l in data["logs"] if l["target_id"] == "99"]
        self.assertTrue(len(matching) > 0)
        self.assertEqual(matching[0]["username"], "operator_diego")
        self.assertEqual(matching[0]["channel"], "cloudhub")


if __name__ == "__main__":
    unittest.main()
