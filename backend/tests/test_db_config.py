import unittest
import os
from unittest.mock import patch

class TestDbConfig(unittest.TestCase):
    def test_previews_dir_default(self):
        with patch.dict(os.environ, {}, clear=True):
            import importlib
            import database.db
            importlib.reload(database.db)
            self.assertEqual(database.db.PREVIEWS_DIR, "/tmp/ffmpeg-gui-previews")
