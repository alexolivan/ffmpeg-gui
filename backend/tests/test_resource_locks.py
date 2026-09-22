import unittest
from core.resource_lock_manager import ResourceLockManager, resource_lock_manager


class TestResourceLockManager(unittest.TestCase):

    def setUp(self):
        self.mgr = resource_lock_manager
        self.mgr.clear_all()

    def tearDown(self):
        self.mgr.clear_all()

    def test_extract_resource_info_icecast(self):
        # Case 1: Local provider service
        out1 = {
            "type": "icecast",
            "provider_service_id": 5,
            "icecast_mount": "fm_rock.mp3"
        }
        info1 = self.mgr.extract_resource_info(out1)
        self.assertIsNotNone(info1)
        self.assertEqual(info1["key"], "service:5:icecast:/fm_rock.mp3")
        self.assertEqual(info1["service_type"], "icecast")
        self.assertEqual(info1["resource_path"], "/fm_rock.mp3")
        self.assertEqual(info1["target_type"], "service")
        self.assertEqual(info1["target_id"], 5)

        # Case 2: Federated peer provider service
        out2 = {
            "type": "icecast",
            "peer_node_id": 2,
            "peer_service_id": 8,
            "icecast_mount": "/station.ogg"
        }
        info2 = self.mgr.extract_resource_info(out2)
        self.assertIsNotNone(info2)
        self.assertEqual(info2["key"], "peer:2:8:icecast:/station.ogg")
        self.assertEqual(info2["target_type"], "peer")

        # Case 3: Direct manual endpoint
        out3 = {
            "type": "icecast",
            "host": "vps1.example.com",
            "port": 8000,
            "icecast_mount": "/live"
        }
        info3 = self.mgr.extract_resource_info(out3)
        self.assertIsNotNone(info3)
        self.assertEqual(info3["key"], "endpoint:vps1.example.com:8000:icecast:/live")
        self.assertEqual(info3["target_type"], "endpoint")

    def test_extract_resource_info_mediamtx(self):
        # Case 1: SRT publisher with mediamtx_mode
        out_srt_pub = {
            "type": "srt",
            "provider_service_id": 12,
            "mediamtx_mode": True,
            "stream_action": "publish",
            "path_id": "cam_main"
        }
        info_pub = self.mgr.extract_resource_info(out_srt_pub)
        self.assertIsNotNone(info_pub)
        self.assertEqual(info_pub["key"], "service:12:mediamtx:cam_main")
        self.assertEqual(info_pub["service_type"], "mediamtx")
        self.assertEqual(info_pub["resource_path"], "cam_main")

        # Case 2: SRT consumer (stream_action == request) -> No exclusive publisher lock
        out_srt_req = {
            "type": "srt",
            "provider_service_id": 12,
            "mediamtx_mode": True,
            "stream_action": "request",
            "path_id": "cam_main"
        }
        info_req = self.mgr.extract_resource_info(out_srt_req)
        self.assertIsNone(info_req)

        # Case 3: RTMP publisher with stream path
        out_rtmp = {
            "type": "rtmp",
            "host": "192.168.1.100",
            "port": 1935,
            "path_id": "studio/tx1"
        }
        info_rtmp = self.mgr.extract_resource_info(out_rtmp)
        self.assertIsNotNone(info_rtmp)
        self.assertEqual(info_rtmp["key"], "endpoint:192.168.1.100:1935:mediamtx:studio/tx1")

        # Case 4: Non-exclusive destinations (file, alsa) -> None
        self.assertIsNone(self.mgr.extract_resource_info({"type": "file", "path": "/record.mp4"}))
        self.assertIsNone(self.mgr.extract_resource_info({"type": "alsa", "path": "hw:0,0"}))

    def test_acquire_and_collision_interlock(self):
        out_cfg = {
            "type": "icecast",
            "provider_service_id": 3,
            "icecast_mount": "/stream.mp3"
        }

        # 1. Owner 1 (Service 10) acquires lock
        ok1, err1, lock1 = self.mgr.acquire_lock("service", 10, out_cfg, owner_name="Emisora 1")
        self.assertTrue(ok1)
        self.assertIsNone(err1)
        self.assertIsNotNone(lock1)
        self.assertEqual(lock1["owner_name"], "Emisora 1")

        # 2. Owner 1 re-acquires (e.g. restart) -> Success
        ok_re, err_re, lock_re = self.mgr.acquire_lock("service", 10, out_cfg, owner_name="Emisora 1")
        self.assertTrue(ok_re)
        self.assertIsNone(err_re)

        # 3. Owner 2 (ScheduledTask 99) attempts to acquire same mount -> Collision!
        ok2, err2, lock2 = self.mgr.acquire_lock("task", 99, out_cfg, owner_name="Tarea Noche")
        self.assertFalse(ok2)
        self.assertIsNotNone(err2)
        self.assertIn("ya está siendo emitido por service 'Emisora 1'", err2)
        self.assertEqual(lock2["owner_id"], 10)

        # 4. Check active locks
        active = self.mgr.get_active_locks()
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]["resource_path"], "/stream.mp3")

        # 5. Owner 1 releases lock
        self.mgr.release_lock("service", 10)
        self.assertEqual(len(self.mgr.get_active_locks()), 0)

        # 6. Owner 2 can now acquire lock
        ok2_retry, err2_retry, lock2_retry = self.mgr.acquire_lock("task", 99, out_cfg, owner_name="Tarea Noche")
        self.assertTrue(ok2_retry)
        self.assertIsNone(err2_retry)

    def test_peer_lock_acquisition_and_conflict(self):
        out_cfg = {
            "type": "icecast",
            "provider_service_id": 1,
            "icecast_mount": "/master.ogg"
        }

        # 1. Remote peer acquires lock via RPC
        ok_peer, err_peer, lock_peer = self.mgr.acquire_peer_lock(
            token_id="fgp_k_test1",
            service_id=1,
            service_type="icecast",
            resource_path="/master.ogg",
            peer_name="Test Node 1"
        )
        self.assertTrue(ok_peer)
        self.assertIsNone(err_peer)

        # 2. Local service attempts to acquire same mount -> Collision with peer!
        ok_local, err_local, lock_local = self.mgr.acquire_lock("service", 7, out_cfg, owner_name="Local Radio")
        self.assertFalse(ok_local)
        self.assertIn("ya está siendo emitido", err_local)
        self.assertEqual(lock_local["owner_type"], "remote_peer")
        self.assertEqual(lock_local["owner_name"], "Test Node 1")

        # 3. Peer token releases lock
        self.mgr.release_peer_locks("fgp_k_test1")
        self.assertEqual(len(self.mgr.get_active_locks()), 0)

        # 4. Local service now succeeds
        ok_local_again, err_local_again, _ = self.mgr.acquire_lock("service", 7, out_cfg, owner_name="Local Radio")
        self.assertTrue(ok_local_again)

    def test_is_resource_locked_with_exclusion(self):
        out_cfg = {
            "type": "icecast",
            "provider_service_id": 2,
            "icecast_mount": "/live.mp3"
        }
        self.mgr.acquire_lock("service", 42, out_cfg, owner_name="Service 42")

        # Checking from owner 42 should report not locked (it's its own lock)
        is_locked_self, _ = self.mgr.is_resource_locked(out_cfg, exclude_owner_type="service", exclude_owner_id=42)
        self.assertFalse(is_locked_self)

        # Checking from another process should report locked
        is_locked_other, info_other = self.mgr.is_resource_locked(out_cfg, exclude_owner_type="service", exclude_owner_id=99)
        self.assertTrue(is_locked_other)
        self.assertEqual(info_other["owner_id"], 42)


if __name__ == "__main__":
    unittest.main()
