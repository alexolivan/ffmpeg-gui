import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import datetime
import tempfile
import unittest
from sqlalchemy import create_engine, text

import database.db
from database.version import __schema_version__

class TestDatabaseVersion(unittest.TestCase):
    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp()
        os.close(self.db_fd)
        
    def tearDown(self):
        if os.path.exists(self.db_path):
            try:
                os.unlink(self.db_path)
            except OSError:
                pass

    def test_schema_version_is_initialized(self):
        orig_db_path = database.db.DB_PATH
        orig_engine = database.db.engine
        
        database.db.DB_PATH = self.db_path
        test_engine = create_engine(f"sqlite:///{self.db_path}")
        database.db.engine = test_engine
        
        try:
            database.db.init_db()
            
            with test_engine.connect() as conn:
                res = conn.execute(text("SELECT version FROM schema_info ORDER BY id DESC LIMIT 1"))
                row = res.fetchone()
                
            self.assertIsNotNone(row)
            self.assertEqual(row[0], __schema_version__)
        finally:
            test_engine.dispose()
            database.db.DB_PATH = orig_db_path
            database.db.engine = orig_engine
