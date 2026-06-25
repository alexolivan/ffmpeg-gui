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

if __name__ == '__main__':
    unittest.main()
