import unittest
from unittest.mock import MagicMock, patch
import sys
import os

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from core.process_manager import ProcessManager

class TestCommandGenerator(unittest.TestCase):
    def setUp(self):
        # Create a mock database session factory
        self.mock_session_factory = MagicMock()
        self.pm = ProcessManager(self.mock_session_factory)
        # Set a dummy ffmpeg path
        self.pm.ffmpeg_path = "ffmpeg"

    @patch('utils.process_utils.get_ffmpeg_version')
    def test_srt_input_and_output(self, mock_version):
        mock_version.return_value = 5.0
        
        # Test Case 1: SRT Caller input and SRT Listener output
        media_proc = MagicMock()
        media_proc.id = 42
        media_proc.type = "service"
        media_proc.input_config = {
            'type': 'srt',
            'mode': 'caller',
            'host': '1.2.3.4',
            'port': '9999',
            'latency': 150,
            'streamid': 'input_id'
        }
        media_proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac',
            'video_params': {},
            'audio_params': {}
        }
        media_proc.filter_config = {}
        media_proc.output_config = {
            'type': 'srt',
            'mode': 'listener',
            'host': '0.0.0.0',
            'port': '8888',
            'latency': 200,
            'streamid': 'output_id'
        }
        
        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        
        # Check input URL
        self.assertIn("srt://1.2.3.4:9999?mode=caller&latency=150&timeout=5000000&streamid=input_id", cmd_str)
        # Check output URL
        self.assertIn("srt://0.0.0.0:8888?mode=listener&latency=200&timeout=5000000&streamid=output_id", cmd_str)
        # Check Annex B filter for H.264 into SRT/mpegts
        self.assertIn("-bsf:v h264_mp4toannexb", cmd_str)

    def test_ndi_input_and_output(self):
        # Test Case 2: NDI Input (no find_sources) and NDI Output (format=uyvy422)
        media_proc = MagicMock()
        media_proc.id = 43
        media_proc.type = "service"
        media_proc.input_config = {
            'type': 'ndi',
            'name': 'MY-NDI-SOURCE'
        }
        media_proc.codec_config = {
            'vcodec': 'rawvideo',
            'acodec': 'pcm_s16le',
            'video_params': {},
            'audio_params': {}
        }
        media_proc.filter_config = {}
        media_proc.output_config = {
            'type': 'ndi',
            'path': 'NDI-OUT'
        }
        
        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        
        # Check NDI input syntax
        self.assertIn("-f libndi_newtek -i MY-NDI-SOURCE", cmd_str)
        # Check that we did NOT include -find_sources 1
        self.assertNotIn("-find_sources 1 -i MY-NDI-SOURCE", cmd_str)
        # Check NDI format requirement
        self.assertIn("-vf format=uyvy422", cmd_str)
        # Check NDI output syntax
        self.assertIn("-f libndi_newtek NDI-OUT", cmd_str)

    def test_dvb_mpegts_parameters(self):
        # Test Case 3: UDP output with DVB metadata and custom PIDs
        media_proc = MagicMock()
        media_proc.id = 44
        media_proc.type = "service"
        media_proc.input_config = {
            'type': 'file',
            'path': 'input.mp4'
        }
        media_proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac'
        }
        media_proc.filter_config = {}
        media_proc.output_config = {
            'type': 'udp',
            'host': '239.0.0.1',
            'port': '5001',
            'pkt_size': '1316',
            'muxrate': '10M',
            'ts_id': 100,
            'net_id': 200,
            'service_id': 300,
            'pmt_start_pid': 4000,
            'start_pid': 4001,
            'service_provider': 'MyProvider',
            'service_name': 'MyChannel',
            'service_type': 'digital_tv',
            'audio_language': 'spa',
            'pat_pmt_at_frames': True,
            'system_b': True
        }
        
        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        
        # Check UDP destination with pkt_size
        self.assertIn("udp://239.0.0.1:5001?pkt_size=1316", cmd_str)
        # Check CBR muxrate
        self.assertIn("-muxrate 10M", cmd_str)
        # Check PIDs
        self.assertIn("-mpegts_transport_stream_id 100", cmd_str)
        self.assertIn("-mpegts_original_network_id 200", cmd_str)
        self.assertIn("-mpegts_service_id 300", cmd_str)
        self.assertIn("-mpegts_pmt_start_pid 4000", cmd_str)
        self.assertIn("-mpegts_start_pid 4001", cmd_str)
        # Check metadata & flags
        self.assertIn("service_provider=MyProvider", cmd_str)
        self.assertIn("service_name=MyChannel", cmd_str)
        self.assertIn("-mpegts_service_type digital_tv", cmd_str)
        self.assertIn("-metadata:s:a:0 language=spa", cmd_str)
        self.assertIn("-mpegts_flags pat_pmt_at_frames+system_b", cmd_str)

    def test_vram_cpu_boundaries(self):
        # Test Case 4: VRAM source with software encoding (needs download)
        media_proc = MagicMock()
        media_proc.id = 45
        media_proc.type = "service"
        media_proc.input_config = {
            'input1': {
                'type': 'decklink',
                'device': 'DeckLink Mini Recorder',
                'frames_destination': 'vram',
                'hwaccel': 'cuda'
            }
        }
        media_proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac'
        }
        media_proc.filter_config = {
            'advanced': {
                'hwaccel': 'cuda'
            },
            'scale': '1280x720'
        }
        media_proc.output_config = {
            'type': 'file',
            'path': 'output.mp4'
        }
        
        cmd = self.pm._build_ffmpeg_cmd(media_proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        
        # Check scale_npp (VRAM filter) and then hwdownload & format=nv12 (download to CPU for libx264)
        self.assertIn("-vf scale_npp=1280:720,hwdownload,format=nv12", cmd_str)

    def test_realtime_flag_configurations(self):
        # Case 1: network input, manual realtime=True (Always ON) -> should include -re
        proc_1 = MagicMock()
        proc_1.id = 101
        proc_1.type = "service"
        proc_1.input_config = {
            'type': 'srt',
            'host': '127.0.0.1',
            'port': '9999'
        }
        proc_1.codec_config = {'vcodec': 'copy', 'acodec': 'copy'}
        proc_1.filter_config = {'advanced': {'realtime': True}}
        proc_1.output_config = {'type': 'file', 'path': 'output.mp4'}
        cmd_1 = self.pm._build_ffmpeg_cmd(proc_1, "ffmpeg")
        self.assertIn("-re", cmd_1)

        # Case 2: network input, manual realtime=False (Always OFF) -> should NOT include -re
        proc_2 = MagicMock()
        proc_2.id = 102
        proc_2.type = "service"
        proc_2.input_config = {
            'type': 'srt',
            'host': '127.0.0.1',
            'port': '9999'
        }
        proc_2.codec_config = {'vcodec': 'copy', 'acodec': 'copy'}
        proc_2.filter_config = {'advanced': {'realtime': False}}
        proc_2.output_config = {'type': 'file', 'path': 'output.mp4'}
        cmd_2 = self.pm._build_ffmpeg_cmd(proc_2, "ffmpeg")
        self.assertNotIn("-re", cmd_2)

        # Case 3: network input, auto realtime=None -> should NOT include -re
        proc_3 = MagicMock()
        proc_3.id = 103
        proc_3.type = "service"
        proc_3.input_config = {
            'type': 'srt',
            'host': '127.0.0.1',
            'port': '9999'
        }
        proc_3.codec_config = {'vcodec': 'copy', 'acodec': 'copy'}
        proc_3.filter_config = {'advanced': {'realtime': None}}
        proc_3.output_config = {'type': 'file', 'path': 'output.mp4'}
        cmd_3 = self.pm._build_ffmpeg_cmd(proc_3, "ffmpeg")
        self.assertNotIn("-re", cmd_3)

        # Case 4: self-paced input (file), auto realtime=None -> should include -re
        proc_4 = MagicMock()
        proc_4.id = 104
        proc_4.type = "service"
        proc_4.input_config = {
            'type': 'file',
            'path': 'input.mp4'
        }
        proc_4.codec_config = {'vcodec': 'copy', 'acodec': 'copy'}
        proc_4.filter_config = {'advanced': {'realtime': None}}
        proc_4.output_config = {'type': 'file', 'path': 'output.mp4'}
        cmd_4 = self.pm._build_ffmpeg_cmd(proc_4, "ffmpeg")
        self.assertIn("-re", cmd_4)

        # Case 5: self-paced input (file), manual realtime=False -> should NOT include -re
        proc_5 = MagicMock()
        proc_5.id = 105
        proc_5.type = "service"
        proc_5.input_config = {
            'type': 'file',
            'path': 'input.mp4'
        }
        proc_5.codec_config = {'vcodec': 'copy', 'acodec': 'copy'}
        proc_5.filter_config = {'advanced': {'realtime': False}}
        proc_5.output_config = {'type': 'file', 'path': 'output.mp4'}
        cmd_5 = self.pm._build_ffmpeg_cmd(proc_5, "ffmpeg")
        self.assertNotIn("-re", cmd_5)

    def test_non_hwdec_input_sanitization(self):
        # Create a mock with stale hwaccel config on a lavfi_video input
        proc = MagicMock()
        proc.id = 201
        proc.type = "service"
        proc.input_config = {
            'input1': {
                'type': 'lavfi_video',
                'pattern': 'testsrc',
                'hwaccel': 'cuda',
                'frames_destination': 'vram'
            }
        }
        proc.codec_config = {'vcodec': 'libx264', 'acodec': 'aac'}
        # Even with advanced.hwaccel set, it should be ignored for lavfi
        proc.filter_config = {'advanced': {'hwaccel': 'cuda'}}
        proc.output_config = {'type': 'file', 'path': 'output.mp4'}

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        # Assert no -hwaccel cuda or -hwaccel_output_format cuda is in the command
        self.assertNotIn("-hwaccel", cmd_str)
        self.assertNotIn("cuda", cmd)  # should not have cuda in the input parameters
        # Assert preview filter chain does not contain hwdownload or format=nv12
        self.assertIn("fps=1,scale=480:-1", cmd_str)
        self.assertNotIn("hwdownload", cmd_str)

    def test_whip_output_command_generation(self):
        proc = MagicMock()
        proc.id = 301
        proc.type = "service"
        proc.input_config = {'type': 'lavfi_video', 'pattern': 'testsrc'}
        proc.codec_config = {'vcodec': 'libx264', 'acodec': 'aac'}
        proc.filter_config = {}
        proc.output_config = {
            'type': 'whip',
            'url': 'http://localhost:8889/mystream/whip'
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-f whip http://localhost:8889/mystream/whip", cmd_str)

    def test_alsa_output_command_generation(self):
        proc = MagicMock()
        proc.id = 302
        proc.type = "service"
        proc.input_config = {'type': 'lavfi_audio', 'has_video': False, 'has_audio': True}
        proc.codec_config = {'vcodec': 'none', 'acodec': 'pcm_s16le'}
        proc.filter_config = {}
        proc.output_config = {
            'type': 'alsa',
            'device': 'hw:0,0'
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-f alsa hw:0,0", cmd_str)

    def test_progress_telemetry_command_generation(self):
        proc = MagicMock()
        proc.id = 500
        proc.type = "service"
        proc.input_config = {'type': 'file', 'path': '/path/to/input.mp4'}
        proc.codec_config = {'vcodec': 'libx264', 'acodec': 'aac'}
        proc.filter_config = {}
        proc.output_config = {'type': 'file', 'path': '/path/to/output.mp4'}

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        
        # Verify -progress parameter is present
        self.assertIn("-progress", cmd)
        progress_idx = cmd.index("-progress")
        progress_val = cmd[progress_idx + 1]
        self.assertTrue(progress_val.endswith("ffmpeg_progress_500.log"))
        
    def test_network_timeouts_command_generation(self):
        # HTTP / HLS
        proc = MagicMock()
        proc.id = 501
        proc.type = "service"
        proc.input_config = {
            'type': 'hls',
            'path': 'http://example.com/live.m3u8',
            'network_timeout': '25'
        }
        proc.codec_config = {'vcodec': 'libx264', 'acodec': 'aac'}
        proc.filter_config = {}
        proc.output_config = {'type': 'file', 'path': '/path/to/output.mp4'}

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        
        # Microseconds for 25 seconds = 25000000
        self.assertIn("-timeout 25000000 -reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i http://example.com/live.m3u8", cmd_str)

        # UDP
        proc.input_config = {
            'type': 'udp',
            'host': '239.0.0.1',
            'port': '1234',
            'network_timeout': 5  # integer test
        }
        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        # Microseconds for 5 seconds = 5000000
        self.assertIn("-timeout 5000000 -i udp://239.0.0.1:1234?fifo_size=1000000", cmd_str)

        # RTMP
        proc.input_config = {
            'type': 'rtmp',
            'path': 'rtmp://example.com/live/stream',
            # network_timeout missing -> should fallback to 15 (15000000 us)
        }
        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        self.assertIn("-rw_timeout 15000000 -i rtmp://example.com/live/stream", cmd_str)

if __name__ == '__main__':
    unittest.main()
