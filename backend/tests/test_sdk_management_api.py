import unittest
import os
import sys
import tempfile
import importlib
import shutil
import io
import zipfile
from fastapi.testclient import TestClient

# Ensure backend folder is in path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class TestSdkManagementAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db_fd, cls.db_path = tempfile.mkstemp()
        cls.original_db_path_env = os.environ.get("DATABASE_PATH")
        os.environ["DATABASE_PATH"] = cls.db_path

        import database.db
        importlib.reload(database.db)
        cls.db_module = database.db

        import main
        importlib.reload(main)
        cls.main_module = main
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        os.close(cls.db_fd)
        if os.path.exists(cls.db_path):
            os.unlink(cls.db_path)

        if cls.original_db_path_env is not None:
            os.environ["DATABASE_PATH"] = cls.original_db_path_env
        elif "DATABASE_PATH" in os.environ:
            del os.environ["DATABASE_PATH"]

        import database.db
        importlib.reload(database.db)
        import main
        importlib.reload(main)

    def setUp(self):
        self.db_module.init_db()
        self.db = self.db_module.SessionLocal()
        self.temp_dir = tempfile.mkdtemp()

        from database.models import Storage
        self.storage1 = Storage(
            name="SDK Storage 1",
            path=os.path.join(self.temp_dir, "storage1"),
            type="sdk",
            is_default=True
        )
        self.storage2 = Storage(
            name="SDK Storage 2",
            path=os.path.join(self.temp_dir, "storage2"),
            type="sdk",
            is_default=False
        )
        self.db.add(self.storage1)
        self.db.add(self.storage2)
        self.db.commit()
        self.db.refresh(self.storage1)
        self.db.refresh(self.storage2)

        os.makedirs(self.storage1.path, exist_ok=True)
        os.makedirs(self.storage2.path, exist_ok=True)

    def tearDown(self):
        self.db.close()
        self.db_module.Base.metadata.drop_all(bind=self.db_module.engine)
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def _create_decklink_zip(self) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("include/DeckLinkAPI.h", "// DeckLink header")
            zf.writestr("include/DeckLinkAPIVersion.h", '#define BLACKMAGIC_DECKLINK_API_VERSION 0x0e020000\n')
        return buf.getvalue()

    def test_get_sdks_list_with_used_by_builds(self):
        from database.models import InstalledSdk, FfmpegBuild

        sdk = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="Blackmagic DeckLink SDK",
            version="14.2",
            storage_id=self.storage1.id,
            relative_path="decklink/14.2",
            size_bytes=1024,
            status="ready"
        )
        self.db.add(sdk)
        self.db.commit()
        self.db.refresh(sdk)

        build = FfmpegBuild(
            name="FFmpeg Custom 14.2",
            ffmpeg_version="6.1",
            install_path="/tmp/build1",
            status="success",
            build_options={},
            sdk_paths={"decklink": "14.2"}
        )
        self.db.add(build)
        self.db.commit()

        res = self.client.get("/sdks")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)

        found_sdk = next((s for s in data if s["id"] == sdk.id), None)
        self.assertIsNotNone(found_sdk)
        self.assertIn("used_by_builds", found_sdk)
        self.assertIn("FFmpeg Custom 14.2", found_sdk["used_by_builds"])

    def test_post_sdk_upload(self):
        zip_bytes = self._create_decklink_zip()
        res = self.client.post(
            "/sdks/upload",
            data={"sdk_type": "decklink", "storage_id": self.storage1.id},
            files={"file": ("DeckLink_SDK_14.2.zip", zip_bytes, "application/zip")}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("version"), "14.2")

    def test_delete_sdk_conflict_when_in_use(self):
        from database.models import InstalledSdk, FfmpegBuild

        sdk = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="Blackmagic DeckLink SDK",
            version="14.2",
            storage_id=self.storage1.id,
            relative_path="decklink/14.2",
            size_bytes=1024,
            status="ready"
        )
        self.db.add(sdk)
        self.db.commit()

        build = FfmpegBuild(
            name="Active Build",
            ffmpeg_version="6.1",
            install_path="/tmp/build2",
            status="success",
            build_options={},
            sdk_paths={"decklink": "14.2"}
        )
        self.db.add(build)
        self.db.commit()

        res = self.client.delete(f"/sdks/{sdk.id}")
        self.assertEqual(res.status_code, 409)

    def test_delete_sdk_force_success(self):
        from database.models import InstalledSdk, FfmpegBuild

        sdk = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="Blackmagic DeckLink SDK",
            version="14.2",
            storage_id=self.storage1.id,
            relative_path="decklink/14.2",
            size_bytes=1024,
            status="ready"
        )
        self.db.add(sdk)
        self.db.commit()

        build = FfmpegBuild(
            name="Active Build",
            ffmpeg_version="6.1",
            install_path="/tmp/build3",
            status="success",
            build_options={},
            sdk_paths={"decklink": "14.2"}
        )
        self.db.add(build)
        self.db.commit()

        res = self.client.delete(f"/sdks/{sdk.id}?force=true")
        self.assertEqual(res.status_code, 200)

        self.db.refresh(sdk)
        self.assertEqual(sdk.status, "missing")

    def test_post_sdk_migrate(self):
        from database.models import InstalledSdk

        sdk_dir = os.path.join(self.storage1.path, "decklink", "14.2")
        os.makedirs(sdk_dir, exist_ok=True)
        with open(os.path.join(sdk_dir, "dummy.txt"), "w") as f:
            f.write("test")

        sdk = InstalledSdk(
            target_app="ffmpeg",
            sdk_type="decklink",
            name="Blackmagic DeckLink SDK",
            version="14.2",
            storage_id=self.storage1.id,
            relative_path="decklink/14.2",
            size_bytes=1024,
            status="ready"
        )
        self.db.add(sdk)
        self.db.commit()

        res = self.client.post(
            f"/sdks/{sdk.id}/migrate",
            json={"target_storage_id": self.storage2.id}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("storage_id"), self.storage2.id)


if __name__ == "__main__":
    unittest.main()
