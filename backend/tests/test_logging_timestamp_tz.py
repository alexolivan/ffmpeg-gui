import unittest
from datetime import datetime, timezone

class TestLoggingTimestampTz(unittest.TestCase):
    def test_utc_formatting(self):
        dt_utc = datetime.now(timezone.utc)
        iso_str = dt_utc.isoformat()
        self.assertTrue("+" in iso_str or iso_str.endswith("Z") or "T" in iso_str)

    def test_local_formatting(self):
        dt_local = datetime.now().astimezone()
        iso_str = dt_local.isoformat()
        self.assertIn("T", iso_str)
        self.assertTrue("+" in iso_str or "-" in iso_str or iso_str.endswith("Z"))

if __name__ == "__main__":
    unittest.main()
