import unittest
from backend.core.circuit_breaker import analyze_fatal_error

class TestCircuitBreaker(unittest.TestCase):
    def test_protocol_not_found(self):
        logs = [
            "[info] ffmpeg version 7.1.3 Copyright (c) 2000-2024",
            "[URL @ 0x55d14e0] Protocol 'whip' not found",
            "http://127.0.0.1:8889/live/whip: Protocol not found"
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=0.5)
        self.assertTrue(is_fatal)
        self.assertIn("Protocol not supported", reason)
        self.assertIn("whip", reason)

    def test_unknown_format(self):
        logs = [
            "Unknown output format: 'whip'"
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=0.2)
        self.assertTrue(is_fatal)
        self.assertIn("Format not supported", reason)

    def test_unknown_encoder(self):
        logs = [
            "[vost#0:0/libx265 @ 0x55d14e0] Unknown encoder 'libx265'"
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=1.0)
        self.assertTrue(is_fatal)
        self.assertIn("Encoder not supported", reason)
        self.assertIn("libx265", reason)

    def test_unrecognized_option(self):
        logs = [
            "Unrecognized option 'bad_flag'."
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=0.1)
        self.assertTrue(is_fatal)
        self.assertIn("Unrecognized CLI option", reason)

    def test_transient_network_error_not_fatal(self):
        logs = [
            "[tcp @ 0x55d14e0] Connection to tcp://192.168.1.50:9000 failed: Connection refused",
            "srt://192.168.1.50:9000: Connection refused"
        ]
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=1.2)
        self.assertFalse(is_fatal)
        self.assertIsNone(reason)

    def test_long_running_crash_not_tripped_by_circuit_breaker(self):
        logs = [
            "Protocol 'whip' not found"
        ]
        # Ran for 15 seconds before crashing -> not an immediate startup syntax/binary failure
        is_fatal, reason = analyze_fatal_error(logs, execution_duration=15.0)
        self.assertFalse(is_fatal)
        self.assertIsNone(reason)

    def test_empty_logs(self):
        is_fatal, reason = analyze_fatal_error([], execution_duration=0.5)
        self.assertFalse(is_fatal)
        self.assertIsNone(reason)

if __name__ == '__main__':
    unittest.main()
