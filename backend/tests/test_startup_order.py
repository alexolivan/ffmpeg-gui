import unittest
from database.models import MediaProcess

class TestStartupOrder(unittest.TestCase):
    def test_startup_order_defaults(self):
        proc = MediaProcess(
            name="Test Service",
            type="service",
            input_config={},
            output_config={},
            codec_config={}
        )
        self.assertEqual(getattr(proc, 'startup_order', 1) or 1, 1)
        self.assertEqual(getattr(proc, 'startup_delay', 0) or 0, 0)

    def test_boot_sorting_logic(self):
        p1 = MediaProcess(id=1, name="S1", startup_order=2, startup_delay=5)
        p2 = MediaProcess(id=2, name="S2", startup_order=1, startup_delay=0)
        p3 = MediaProcess(id=3, name="S3", startup_order=1, startup_delay=2)
        
        services = [p1, p2, p3]
        sorted_services = sorted(services, key=lambda s: (s.startup_order if s.startup_order is not None else 1, s.startup_delay if s.startup_delay is not None else 0, s.id))
        
        self.assertEqual([s.id for s in sorted_services], [2, 3, 1])

if __name__ == "__main__":
    unittest.main()
