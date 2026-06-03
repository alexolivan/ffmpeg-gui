import unittest
import datetime
from utils.cron_helper import CronHelper

class TestCronHelper(unittest.TestCase):
    def test_cron_helper_next_run(self):
        # Cron matching every 10 minutes
        cron = "*/10 * * * *"
        base = datetime.datetime(2026, 6, 3, 12, 0, 0)
        nxt = CronHelper.get_next_run(cron, base)
        self.assertEqual(nxt, datetime.datetime(2026, 6, 3, 12, 10, 0))

    def test_cron_helper_invalid_cron(self):
        self.assertFalse(CronHelper.validate_cron("invalid cron expression"))
        self.assertTrue(CronHelper.validate_cron("*/10 * * * *"))
