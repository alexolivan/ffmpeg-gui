import os
import shutil
import unittest
from database.db import SessionLocal, init_db, engine, Base
from database.models import InstalledSdk, Storage

class TestSdkSeeding(unittest.TestCase):
    def setUp(self):
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()
        self.test_sdk_dir = os.path.abspath("data/sdks/decklink/99.9")
        os.makedirs(self.test_sdk_dir, exist_ok=True)
        with open(os.path.join(self.test_sdk_dir, "test_header.h"), "w") as f:
            f.write("// dummy test header")

    def tearDown(self):
        if os.path.exists(self.test_sdk_dir):
            shutil.rmtree(self.test_sdk_dir)
        self.db.query(InstalledSdk).filter(InstalledSdk.version == "99.9").delete()
        self.db.commit()
        self.db.close()

    def test_init_db_seeds_preexisting_disk_sdks(self):
        init_db()
        sdk = self.db.query(InstalledSdk).filter(
            InstalledSdk.sdk_type == "decklink",
            InstalledSdk.version == "99.9"
        ).first()
        self.assertIsNotNone(sdk)
        self.assertEqual(sdk.status, "ready")
        self.assertEqual(sdk.target_app, "ffmpeg")

if __name__ == '__main__':
    unittest.main()
