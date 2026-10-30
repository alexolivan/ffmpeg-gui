import unittest
from unittest.mock import patch, MagicMock
import os
import sys

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from cli import handle_reset_password, handle_clear_password, handle_unlock_ips, handle_status


class TestAdminCLI(unittest.TestCase):
    @patch("cli.SessionLocal")
    def test_reset_password_updates_db(self, mock_session_factory):
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_session.query.return_value.first.return_value = mock_settings
        mock_session_factory.return_value.__enter__.return_value = mock_session

        success = handle_reset_password("NewSecretPassword123")
        self.assertTrue(success)
        self.assertEqual(mock_settings.gui_password, "NewSecretPassword123")
        mock_session.commit.assert_called_once()

    @patch("cli.SessionLocal")
    def test_reset_password_too_short(self, mock_session_factory):
        success = handle_reset_password("123")
        self.assertFalse(success)

    @patch("cli.SessionLocal")
    def test_clear_password_removes_auth(self, mock_session_factory):
        mock_session = MagicMock()
        mock_settings = MagicMock()
        mock_session.query.return_value.first.return_value = mock_settings
        mock_session_factory.return_value.__enter__.return_value = mock_session

        success = handle_clear_password()
        self.assertTrue(success)
        self.assertIsNone(mock_settings.gui_password)
        mock_session.commit.assert_called_once()

    @patch("subprocess.run")
    def test_unlock_ips_reloads_service(self, mock_subproc):
        mock_subproc.return_value = MagicMock(returncode=0)
        success = handle_unlock_ips()
        self.assertTrue(success)

    @patch("cli.SessionLocal")
    @patch("subprocess.run")
    def test_status_reports_correct_keys(self, mock_subproc, mock_session_factory):
        mock_subproc.return_value.stdout = "active\n"
        mock_subproc.return_value.returncode = 0
        mock_session = MagicMock()
        mock_settings = MagicMock(
            bind_address="0.0.0.0",
            gui_port=8000,
            http_port=8000,
            https_port=8443,
            ssl_enabled=False,
            gui_password="configured"
        )
        mock_session.query.return_value.first.return_value = mock_settings
        mock_session_factory.return_value.__enter__.return_value = mock_session

        info = handle_status()
        self.assertIn("version", info)
        self.assertIn("schema_version", info)
        self.assertIn("git_branch", info)
        self.assertIn("git_commit", info)
        self.assertIn("service_active", info)
        self.assertIn("has_password", info)
        self.assertTrue(info["has_password"])

    def test_parser_aliases(self):
        import argparse
        from cli import main
        # Test that sys.argv with aliases parses without exiting with error
        with patch("sys.argv", ["cli.py", "reset-admin", "NewPass123"]), \
             patch("cli.handle_reset_password", return_value=True) as mock_reset:
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)
            mock_reset.assert_called_once_with("NewPass123")

        with patch("sys.argv", ["cli.py", "reset-lockout"]), \
             patch("cli.handle_unlock_ips", return_value=True) as mock_unlock:
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)
            mock_unlock.assert_called_once()

        with patch("sys.argv", ["cli.py", "clear-admin"]), \
             patch("cli.handle_clear_password", return_value=True) as mock_clear:
            try:
                main()
            except SystemExit as e:
                self.assertEqual(e.code, 0)
            mock_clear.assert_called_once()

    @patch("cli.update_config_file")
    @patch("cli.check_service_active")
    def test_set_listen(self, mock_svc, mock_cfg):
        mock_svc.return_value = (False, None)
        from cli import handle_set_listen
        res = handle_set_listen("127.0.0.1", port=8080, disable_ssl=True)
        self.assertTrue(res)
        mock_cfg.assert_called_with(bind_address="127.0.0.1", port=8080, ssl_enabled=False)

    @patch("cli.update_config_file")
    @patch("cli.check_service_active")
    @patch("core.cloud_tunnel_client.CloudTunnelClient.enroll")
    def test_enroll_cloudhub_default_preserves_network_config(
        self, mock_enroll, mock_svc, mock_cfg
    ):
        mock_svc.return_value = (False, None)
        mock_enroll.return_value = {"node_id": "ch_node_test123"}

        from cli import handle_enroll_cloudhub
        res = handle_enroll_cloudhub(
            hub_url="http://127.0.0.1:9000",
            token="test_token_123",
        )
        self.assertTrue(res)
        mock_cfg.assert_not_called()
        mock_enroll.assert_called_once_with("http://127.0.0.1:9000", "test_token_123")

    @patch("cli.read_network_config")
    @patch("cli.update_config_file")
    @patch("cli.check_service_active")
    @patch("core.cloud_tunnel_client.CloudTunnelClient.enroll")
    def test_enroll_cloudhub_disables_ssl_if_requested(
        self, mock_enroll, mock_svc, mock_cfg, mock_net_cfg
    ):
        mock_svc.return_value = (False, None)
        mock_enroll.return_value = {"node_id": "ch_node_test123"}
        mock_net_cfg.return_value = {
            "ssl_enabled": True,
            "ssl_mode": "acme",
            "bind_address": "0.0.0.0",
        }

        from cli import handle_enroll_cloudhub
        res = handle_enroll_cloudhub(
            hub_url="http://127.0.0.1:9000",
            token="test_token_123",
            disable_local_ssl=True,
            non_interactive=True,
        )
        self.assertTrue(res)
        mock_cfg.assert_called_with(bind_address="127.0.0.1", ssl_enabled=False)
        mock_enroll.assert_called_once_with("http://127.0.0.1:9000", "test_token_123")

    @patch("cli.SessionLocal")
    @patch("cli.check_service_active")
    @patch("core.cloud_tunnel_client.CloudTunnelClient.disconnect_hub")
    def test_unlink_cloudhub(self, mock_disconnect, mock_svc, mock_session_factory):
        mock_svc.return_value = (False, None)
        mock_session = MagicMock()
        mock_session_factory.return_value.__enter__.return_value = mock_session

        from cli import handle_unlink_cloudhub
        res = handle_unlink_cloudhub()
        self.assertTrue(res)
        mock_disconnect.assert_called_once()

    def test_resolve_db_path_prefers_config_or_filesystem(self):
        from database.db import resolve_db_path
        with patch.dict(os.environ, {"DATABASE_PATH": "/custom/path/ffmpeg_gui.db"}):
            self.assertEqual(resolve_db_path(), "/custom/path/ffmpeg_gui.db")


if __name__ == "__main__":
    unittest.main()

