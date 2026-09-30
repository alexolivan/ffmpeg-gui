import unittest
from unittest.mock import patch, MagicMock
import os
from main import is_cmd_using_alsa_card, check_pid_using_alsa_card, analyze_alsa_process_info


class TestAlsaProcessBinding(unittest.TestCase):
    def test_nvidia_gpu_encoder_does_not_bind_to_card_0(self):
        """Processes using h264_nvenc must NOT be bound to NVIDIA sound card (Card 0)."""
        cmd_nvenc = "/usr/bin/ffmpeg -f lavfi -i testsrc=size=1920x1080:rate=25 -c:v h264_nvenc -b:v 4000k -f null -"
        config_json = '{"codec": {"video_encoder": "h264_nvenc", "gpu_vendor": "nvidia"}}'
        
        # Test against Card 0 (NVIDIA soundcard)
        is_bound = is_cmd_using_alsa_card(cmd_nvenc, config_json, card_index=0, card_id="NVidia")
        self.assertFalse(is_bound, "NVENC video encoder was falsely bound to Card 0 sound card")

    def test_loopback_binding_matches_only_loopback_card(self):
        """Processes using Loopback ALSA device must bind to Card 2 (Loopback) and NOT Card 0."""
        cmd_loopback = "/usr/bin/ffmpeg -f alsa -i plughw:Loopback,1,4 -c:a aac -f null -"
        config_json = '{"input": {"audio_driver": "alsa", "device": "plughw:Loopback,1,4"}}'

        # Card 0 (NVIDIA) must be False
        self.assertFalse(is_cmd_using_alsa_card(cmd_loopback, config_json, card_index=0, card_id="NVidia"))

        # Card 1 (Generic ALC887) must be False
        self.assertFalse(is_cmd_using_alsa_card(cmd_loopback, config_json, card_index=1, card_id="Generic"))

        # Card 2 (Loopback) must be True
        self.assertTrue(is_cmd_using_alsa_card(cmd_loopback, config_json, card_index=2, card_id="Loopback"))

    def test_direct_hw_card_index_matches(self):
        """Processes using hw:1,0 must match Card 1 and not Card 0 or Card 2."""
        cmd = "/usr/bin/ffmpeg -f alsa -i hw:1,0 -c:a mp3 -f null -"
        config_json = '{}'

        self.assertFalse(is_cmd_using_alsa_card(cmd, config_json, card_index=0, card_id="NVidia"))
        self.assertTrue(is_cmd_using_alsa_card(cmd, config_json, card_index=1, card_id="Generic"))
        self.assertFalse(is_cmd_using_alsa_card(cmd, config_json, card_index=2, card_id="Loopback"))

    def test_explicit_nvidia_hdmi_audio_matches(self):
        """Processes explicitly targeting hw:CARD=NVidia,DEV=3 must match Card 0."""
        cmd = "/usr/bin/ffmpeg -i https://example.com/audio.mp3 -f alsa hw:CARD=NVidia,DEV=3"
        config_json = '{}'

        self.assertTrue(is_cmd_using_alsa_card(cmd, config_json, card_index=0, card_id="NVidia"))
        self.assertFalse(is_cmd_using_alsa_card(cmd, config_json, card_index=1, card_id="Generic"))

    @patch("os.path.isdir")
    @patch("os.listdir")
    @patch("os.readlink")
    def test_check_pid_using_alsa_card_with_kernel_fds(self, mock_readlink, mock_listdir, mock_isdir):
        mock_isdir.return_value = True
        mock_listdir.return_value = ["0", "1", "2", "6"]
        
        # PID holding Card 1 playback
        mock_readlink.side_effect = lambda path: {
            "/proc/1095/fd/0": "/dev/null",
            "/proc/1095/fd/1": "/dev/null",
            "/proc/1095/fd/2": "/dev/null",
            "/proc/1095/fd/6": "/dev/snd/pcmC1D0p"
        }.get(path, "")

        # Checking Card 1 -> True
        self.assertTrue(check_pid_using_alsa_card(1095, card_index=1))

        # Checking Card 0 -> False (open snd device belongs to Card 1)
        self.assertFalse(check_pid_using_alsa_card(1095, card_index=0))

        # Checking Card 2 -> False
        self.assertFalse(check_pid_using_alsa_card(1095, card_index=2))

    def test_explicit_card_in_cmd_ignores_stale_json_card_index_0(self):
        """A command targeting hw:1,0 must not bind to Card 0 even if JSON contains stale soundcard: 0."""
        cmd = "/usr/local/src/ffmpeg-gui/backend/ffmpeg_builds/1/install/bin/ffmpeg -f alsa -i hw:1,0 -c:a libmp3lame out.mp3"
        stale_config_json = '{"input": {"type": "alsa", "device": "hw:1,0", "soundcard": 0, "card_index": 0}}'

        self.assertFalse(is_cmd_using_alsa_card(cmd, stale_config_json, card_index=0, card_id="NVidia"))
        self.assertTrue(is_cmd_using_alsa_card(cmd, stale_config_json, card_index=1, card_id="Generic"))
        self.assertFalse(is_cmd_using_alsa_card(cmd, stale_config_json, card_index=2, card_id="Loopback"))

    def test_json_device_string_precedence_over_numeric_card_index(self):
        """When cmd_str is empty, explicit device in JSON takes precedence over numeric card_index."""
        stale_config_json = '{"input": {"type": "alsa", "device": "plughw:1,0", "soundcard": "0", "card_index": 0}}'

        self.assertFalse(is_cmd_using_alsa_card("", stale_config_json, card_index=0, card_id="NVidia"))
        self.assertTrue(is_cmd_using_alsa_card("", stale_config_json, card_index=1, card_id="Generic"))


if __name__ == "__main__":
    unittest.main()

