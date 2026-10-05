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
        
        # Check input URL (caller with network_timeout=15s)
        self.assertIn("srt://1.2.3.4:9999?mode=caller&latency=150&timeout=15000000&streamid=input_id", cmd_str)
        # Check output URL (listener without 5s timeout)
        self.assertIn("srt://0.0.0.0:8888?mode=listener&latency=200&streamid=output_id", cmd_str)
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
        self.assertIn("-c:a pcm_s16le", cmd_str)

    def test_alsa_output_forces_pcm_when_copy_or_non_pcm(self):
        # 1. Test 'copy' is overridden to 'pcm_s16le'
        proc = MagicMock()
        proc.id = 303
        proc.type = "service"
        proc.input_config = {'type': 'http_audio', 'url': 'http://stream.example/audio.mp3', 'has_video': False, 'has_audio': True}
        proc.codec_config = {'vcodec': 'none', 'acodec': 'copy'}
        proc.filter_config = {}
        proc.output_config = {'type': 'alsa', 'device': 'hw:0,0'}

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        self.assertIn("-c:a pcm_s16le", cmd_str)
        self.assertNotIn("-c:a copy", cmd_str)
        self.assertIn("-f alsa hw:0,0", cmd_str)

        # 2. Test non-pcm compressed codec (e.g. 'aac') is also overridden to 'pcm_s16le'
        proc.codec_config['acodec'] = 'aac'
        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        self.assertIn("-c:a pcm_s16le", cmd_str)
        self.assertNotIn("-c:a aac", cmd_str)

        # 3. Test valid PCM codec ('pcm_s24le') is preserved
        proc.codec_config['acodec'] = 'pcm_s24le'
        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)
        self.assertIn("-c:a pcm_s24le", cmd_str)

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
        self.assertTrue(progress_val.endswith("ffmpeg_progress_500s.log"))
        
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

    def test_icecast_output_command_generation(self):
        # Case 1: Standard Icecast 2.4+ output
        proc = MagicMock()
        proc.id = 601
        proc.type = "service"
        proc.input_config = {'type': 'lavfi_audio', 'has_video': False, 'has_audio': True}
        proc.codec_config = {'vcodec': 'none', 'acodec': 'libmp3lame'}
        proc.filter_config = {}
        proc.output_config = {
            'type': 'icecast',
            'host': '127.0.0.1',
            'port': '7000',
            'icecast_mount': '/radio.mp3',
            'icecast_username': 'source',
            'icecast_password': 'mypassword',
            'ice_name': 'My Station',
            'ice_genre': 'Rock',
            'ice_url': 'https://mystation.org',
            'ice_public': True
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-f mp3 -content_type audio/mpeg", cmd_str)
        self.assertIn("-ice_name My Station -ice_genre Rock", cmd_str)
        self.assertIn("-ice_url https://mystation.org", cmd_str)
        self.assertIn("-ice_public 1", cmd_str)
        self.assertNotIn("-legacy_icecast", cmd_str)
        self.assertNotIn("-tls", cmd_str)
        self.assertIn("icecast://source:mypassword@127.0.0.1:7000/radio.mp3", cmd_str)

        # Case 2: Legacy Icecast server (< v2.4, e.g. 2.3.3) with TLS enabled
        proc.output_config = {
            'type': 'icecast',
            'host': '192.168.1.50',
            'port': '8000',
            'icecast_mount': '/legacy.mp3',
            'icecast_username': 'source',
            'icecast_password': 'secret',
            'legacy_icecast': True,
            'tls': True
        }

        cmd_legacy = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_legacy_str = " ".join(cmd_legacy)

        self.assertIn("-legacy_icecast 1", cmd_legacy_str)
        self.assertIn("-tls 1", cmd_legacy_str)
        self.assertIn("icecast://source:secret@192.168.1.50:8000/legacy.mp3", cmd_legacy_str)

        # Case 3: Federated Peer Icecast 2.3.3 node auto-resolves legacy_icecast=True from cached services
        mock_peer = MagicMock()
        mock_peer.id = 10
        mock_peer.cached_services_json = [
            {
                "id": 101,
                "name": "Icecast 2.3.3 Server",
                "alias": "Legacy Node",
                "service_type": "icecast_server",
                "is_legacy": True,
                "protocols": {
                    "port": 8000,
                    "ssl_enabled": False,
                    "is_legacy": True
                }
            }
        ]
        mock_session = MagicMock()
        mock_session.query.return_value.get.return_value = mock_peer
        self.mock_session_factory.return_value.__enter__.return_value = mock_session

        proc.output_config = {
            'type': 'icecast',
            'peer_node_id': 10,
            'peer_service_id': 101,
            'host': 'vps1.example.com',
            'port': '8000',
            'icecast_mount': '/stream.mp3',
            'icecast_username': 'source',
            'icecast_password': 'mypassword',
        }

        cmd_peer = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_peer_str = " ".join(cmd_peer)
        self.assertIn("-legacy_icecast 1", cmd_peer_str)
        self.assertNotIn("-tls 1", cmd_peer_str)
        self.assertIn("icecast://source:mypassword@vps1.example.com:8000/stream.mp3", cmd_peer_str)

        # Case 4: Federated Peer Icecast 2.5 with SSL auto-resolves tls=True & legacy_icecast=False
        mock_peer.cached_services_json = [
            {
                "id": 102,
                "name": "Icecast 2.5 Server",
                "alias": "Modern Node",
                "service_type": "icecast_server",
                "is_legacy": False,
                "protocols": {
                    "port": 8000,
                    "ssl_port": 8443,
                    "ssl_enabled": True,
                    "is_legacy": False
                }
            }
        ]
        proc.output_config = {
            'type': 'icecast',
            'peer_node_id': 10,
            'peer_service_id': 102,
            'host': 'vps1.example.com',
            'port': '8443',
            'icecast_mount': '/stream.mp3',
            'icecast_username': 'source',
            'icecast_password': 'mypassword',
        }

        cmd_peer_ssl = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_peer_ssl_str = " ".join(cmd_peer_ssl)
        self.assertNotIn("-legacy_icecast 1", cmd_peer_ssl_str)
        self.assertIn("-tls 1", cmd_peer_ssl_str)
        self.assertIn("icecast://source:mypassword@vps1.example.com:8443/stream.mp3", cmd_peer_ssl_str)

        # Case 5: Icecast with libvorbis (Ogg Vorbis)
        proc.codec_config = {'vcodec': 'none', 'acodec': 'libvorbis', 'audio_params': {'b:a': '128k', 'ac': 2}}
        proc.output_config = {
            'type': 'icecast',
            'host': '127.0.0.1',
            'port': '8000',
            'icecast_mount': '/stream.ogg',
            'icecast_username': 'source',
            'icecast_password': 'hackme'
        }
        cmd_vorbis = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_vorbis_str = " ".join(cmd_vorbis)
        self.assertIn("-c:a libvorbis", cmd_vorbis_str)
        self.assertIn("-b:a 128k", cmd_vorbis_str)
        self.assertIn("-ac 2", cmd_vorbis_str)
        self.assertIn("-f ogg -content_type application/ogg", cmd_vorbis_str)
        self.assertIn("icecast://source:hackme@127.0.0.1:8000/stream.ogg", cmd_vorbis_str)

    def test_alsa_to_icecast_flac_command_generation(self):
        proc = MagicMock()
        proc.id = 602
        proc.type = "service"
        # ALSA input: even if has_video was mistakenly left True, builder must suppress it with -vn
        proc.input_config = {
            'input1': {'type': 'alsa', 'device': 'hw:Loopback,1,0'},
            'has_video': True,
            'has_audio': True
        }
        proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'flac',
            'audio_params': {'compression_level': '7', 'ac': '2', 'ar': '48000'}
        }
        proc.filter_config = {}
        proc.output_config = {
            'type': 'icecast',
            'host': '127.0.0.1',
            'port': '7000',
            'icecast_mount': '/lossless.flac',
            'icecast_username': 'source',
            'icecast_password': 'hackme',
            'ice_name': 'Lossless Studio Audio',
            'ice_url': 'https://studio.local',
            'ice_public': False,
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        # 1. ALSA input
        self.assertIn("-f alsa -i hw:Loopback,1,0", cmd_str)
        # 2. Audio-only suppression of video mapping (-vn)
        self.assertIn("-vn", cmd_str)
        self.assertNotIn("-map 0:v", cmd_str)
        # 3. Audio mapping
        self.assertIn("-map 0:a", cmd_str)
        # 4. FLAC codec and parameters (no -b:a)
        self.assertIn("-c:a flac", cmd_str)
        self.assertIn("-compression_level 7", cmd_str)
        self.assertIn("-ac 2", cmd_str)
        self.assertIn("-ar 48000", cmd_str)
        self.assertNotIn("-b:a", cmd_str)
        # 5. Container & Content Type (default / .flac extension -> raw flac)
        self.assertIn("-f flac -content_type audio/flac", cmd_str)
        # 6. Metadata
        self.assertIn("-ice_name Lossless Studio Audio", cmd_str)
        self.assertIn("-ice_url https://studio.local", cmd_str)
        self.assertIn("-ice_public 0", cmd_str)
        # 7. Output URL
        self.assertIn("icecast://source:hackme@127.0.0.1:7000/lossless.flac", cmd_str)

        # Case 2: FLAC with .ogg mountpoint auto-detects Ogg FLAC encapsulation (-f ogg -content_type audio/ogg)
        proc.output_config['icecast_mount'] = '/master.ogg'
        cmd_ogg = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_ogg_str = " ".join(cmd_ogg)
        self.assertIn("-c:a flac", cmd_ogg_str)
        self.assertIn("-f ogg -content_type audio/ogg", cmd_ogg_str)
        self.assertIn("icecast://source:hackme@127.0.0.1:7000/master.ogg", cmd_ogg_str)

    def test_libfdk_aac_and_he_v2_generation(self):
        # Case 1: libfdk_aac with HE-AAC v2 and CBR 48k (forces -ac 2 even if ac: 1)
        proc = MagicMock()
        proc.id = 603
        proc.type = "service"
        proc.input_config = {
            'type': 'http_audio',
            'url': 'http://127.0.0.1:7000/master.ogg',
            'has_video': False,
            'has_audio': True
        }
        proc.codec_config = {
            'vcodec': 'none',
            'acodec': 'libfdk_aac',
            'audio_params': {
                'profile:a': 'aac_he_v2',
                'rate_control': 'cbr',
                'b:a': '48k',
                'ac': '1',  # Incompatible with HE-AAC v2, builder must force 2
                'afterburner': '1'
            }
        }
        proc.filter_config = {}
        proc.output_config = {
            'type': 'icecast',
            'host': 'ingest.example.com',
            'port': '8000',
            'icecast_mount': '/stream.aac',
            'icecast_username': 'source',
            'icecast_password': 'secret'
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-c:a libfdk_aac", cmd_str)
        self.assertIn("-b:a 48k", cmd_str)
        self.assertIn("-profile:a aac_he_v2", cmd_str)
        self.assertIn("-ac 2", cmd_str)
        self.assertIn("-afterburner 1", cmd_str)
        self.assertIn("-f adts -content_type audio/aac", cmd_str)
        self.assertIn("icecast://source:secret@ingest.example.com:8000/stream.aac", cmd_str)

        # Case 2: libfdk_aac with VBR quality 3 (omits -b:a, outputs -vbr 3)
        proc.codec_config['audio_params'] = {
            'profile:a': 'aac_low',
            'rate_control': 'vbr',
            'vbr': '3',
            'ac': '2',
            'afterburner': '1'
        }
        cmd_vbr = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_vbr_str = " ".join(cmd_vbr)
        self.assertIn("-c:a libfdk_aac", cmd_vbr_str)
        self.assertIn("-vbr 3", cmd_vbr_str)
        self.assertNotIn("-b:a", cmd_vbr_str)
        self.assertIn("-profile:a aac_low", cmd_vbr_str)

        # Case 3: Native aac with illegal aac_he_v2 profile gracefully falls back to aac_low
        proc.codec_config['acodec'] = 'aac'
        proc.codec_config['audio_params'] = {
            'profile:a': 'aac_he_v2',
            'b:a': '64k',
            'ac': '2'
        }
        cmd_native = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_native_str = " ".join(cmd_native)
        self.assertIn("-c:a aac", cmd_native_str)
        self.assertIn("-profile:a aac_low", cmd_native_str)
        self.assertNotIn("aac_he_v2", cmd_native_str)

    def test_hls_abr_vaapi_cqp_command(self):
        proc = MagicMock()
        proc.id = 50
        proc.type = "service"
        proc.input_config = {
            'type': 'v4l2',
            'path': '/dev/video0',
            'has_video': True,
            'has_audio': True,
            'use_secondary_input': True,
            'input1': {'type': 'v4l2', 'path': '/dev/video0'},
            'input2': {'type': 'alsa', 'path': 'hw:0,0'}
        }
        proc.codec_config = {
            'vcodec': 'h264_vaapi',
            'acodec': 'aac',
            'video_params': {'rc_mode': 'CQP', 'qp': 20},
            'audio_params': {'ac': 2, 'ar': 48000}
        }
        proc.filter_config = {
            'deinterlace': True,
            'advanced': {'threads': 4, 'probesize': '20M', 'thread_queue_size': 8192}
        }
        proc.output_config = {
            'type': 'hls',
            'hls_stream_name': 'stream1',
            'path': '/var/hls/live',
            'hls_time': 2,
            'hls_list_size': 5,
            'hls_delete_segments': True,
            'variants': [
                {'resolution': '1920:1080', 'video_bitrate': '4500k', 'audio_bitrate': '192k'},
                {'resolution': '1280:720', 'video_bitrate': '2500k', 'audio_bitrate': '128k'},
                {'resolution': '854:480', 'video_bitrate': '1200k', 'audio_bitrate': '96k'}
            ]
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        # 1. Global vaapi_device should be present before inputs
        self.assertIn("-vaapi_device /dev/dri/renderD128", cmd_str)

        # 2. Hardware upload should be present in filters
        self.assertIn("format=nv12,hwupload", cmd_str)

        # 3. CQP mode should be used with staggered QP values (20, 24, 28) and NO -b:v:X
        self.assertIn("-c:v:0 h264_vaapi -rc_mode:v:0 CQP -qp:v:0 20", cmd_str)
        self.assertIn("-c:v:1 h264_vaapi -rc_mode:v:1 CQP -qp:v:1 24", cmd_str)
        self.assertIn("-c:v:2 h264_vaapi -rc_mode:v:2 CQP -qp:v:2 28", cmd_str)
        self.assertNotIn("-b:v:0", cmd_str)
        self.assertNotIn("-b:v:1", cmd_str)
        self.assertNotIn("-b:v:2", cmd_str)

        # 4. Master playlist and var_stream_map
        self.assertIn("-master_pl_name stream1.m3u8", cmd_str)
        self.assertIn("-var_stream_map", cmd_str)

    def test_hls_abr_nvenc_command(self):
        proc = MagicMock()
        proc.id = 51
        proc.type = "service"
        proc.input_config = {
            'type': 'v4l2',
            'path': '/dev/video0',
            'has_video': True,
            'has_audio': False,
            'input1': {'type': 'v4l2', 'path': '/dev/video0'}
        }
        proc.codec_config = {
            'vcodec': 'h264_nvenc',
            'acodec': 'none',
            'video_params': {'rc': 'cbr', 'preset': 'p4'},
            'audio_params': {}
        }
        proc.filter_config = {}
        proc.output_config = {
            'type': 'hls',
            'hls_stream_name': 'stream1',
            'path': '/var/hls/live',
            'variants': [
                {'resolution': '1920:1080', 'video_bitrate': '4500k', 'audio_bitrate': '192k'},
                {'resolution': '1280:720', 'video_bitrate': '2500k', 'audio_bitrate': '128k'}
            ]
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        # NVENC accepts software nv12 directly, so hwupload must NOT be in the filter chain
        self.assertNotIn("hwupload", cmd_str)
        self.assertIn("-filter:v:0 scale=1920:1080,format=nv12", cmd_str)
        self.assertIn("-c:v:0 h264_nvenc -rc:v:0 cbr -b:v:0 4500k -preset:v:0 p4", cmd_str)
        self.assertIn("-c:v:1 h264_nvenc -rc:v:1 cbr -b:v:1 2500k -preset:v:1 p4", cmd_str)

    def test_desktop_x11grab_input_default(self):
        proc = MagicMock()
        proc.id = 60
        proc.type = "service"
        proc.input_config = {
            'type': 'desktop',
            'display_num': 99,
            'framerate': 30,
            'video_size': '1920x1080',
            'draw_mouse': 0,
            'has_video': True,
            'has_audio': False
        }
        proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'none',
            'video_params': {},
            'audio_params': {}
        }
        proc.filter_config = {}
        proc.output_config = {
            'type': 'file',
            'path': '/tmp/test_desktop.mp4'
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-f x11grab", cmd_str)
        self.assertIn("-draw_mouse 0", cmd_str)
        self.assertIn("-framerate 30", cmd_str)
        self.assertIn("-video_size 1920x1080", cmd_str)
        self.assertIn("-i :99.0", cmd_str)

    def test_desktop_x11grab_custom_fps_size_mouse(self):
        proc = MagicMock()
        proc.id = 61
        proc.type = "service"
        proc.input_config = {
            'type': 'x11grab',
            'display': ':98',
            'framerate': 60,
            'size': '1280x720',
            'draw_mouse': 1,
            'offset_x': 100,
            'offset_y': 50,
            'has_video': True,
            'has_audio': False
        }
        proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'none',
            'video_params': {},
            'audio_params': {}
        }
        proc.filter_config = {}
        proc.output_config = {
            'type': 'file',
            'path': '/tmp/test_desktop_custom.mp4'
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-f x11grab", cmd_str)
        self.assertIn("-draw_mouse 1", cmd_str)
        self.assertIn("-framerate 60", cmd_str)
        self.assertIn("-video_size 1280x720", cmd_str)
        self.assertIn("-i :98.0+100,50", cmd_str)

    def test_desktop_input_with_provider_auto_resolution(self):
        prov_desktop = MagicMock()
        prov_desktop.id = 15
        prov_desktop.config = {
            'desktop_config': {
                'display_num': 95,
                'resolution': '1920x1080',
                'framerate': 25
            }
        }

        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_session.query.return_value.get.return_value = prov_desktop
        self.mock_session_factory.return_value = mock_session

        proc = MagicMock()
        proc.id = 62
        proc.type = "service"
        proc.input_config = {
            'type': 'desktop',
            'provider_service_id': 15,
            'has_video': True,
            'has_audio': False
        }
        proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'none',
            'video_params': {},
            'audio_params': {}
        }
        proc.filter_config = {}
        proc.output_config = {
            'type': 'file',
            'path': '/tmp/test_desktop_auto.mp4'
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-f x11grab", cmd_str)
        self.assertIn("-draw_mouse 0", cmd_str)
        self.assertIn("-framerate 25", cmd_str)
        self.assertIn("-video_size 1920x1080", cmd_str)
        self.assertIn("-i :95.0", cmd_str)

    def test_desktop_audio_mapping_and_pairing(self):
        # Case 1: Desktop with has_audio=True and NO secondary input
        proc_single = MagicMock()
        proc_single.id = 81
        proc_single.type = "service"
        proc_single.input_config = {
            'type': 'desktop',
            'display_num': 99,
            'video_size': '1920x1080',
            'framerate': 30,
            'has_video': True,
            'has_audio': True
        }
        proc_single.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac',
            'video_params': {},
            'audio_params': {}
        }
        proc_single.filter_config = {}
        proc_single.output_config = {
            'type': 'udp',
            'host': '239.0.0.1',
            'port': 1234
        }

        cmd_single = self.pm._build_ffmpeg_cmd(proc_single, "ffmpeg")
        cmd_str_single = " ".join(cmd_single)

        # Must NOT map nonexistent audio from stream 0 (0:a)
        self.assertNotIn("-map 0:a", cmd_str_single)
        # Should cleanly mute/disable audio with -an
        self.assertIn("-an", cmd_str_single)

        # Case 2: Desktop with paired secondary input (ALSA Loopback hw:Loopback,1,3)
        proc_paired = MagicMock()
        proc_paired.id = 82
        proc_paired.type = "service"
        proc_paired.input_config = {
            'use_secondary_input': True,
            'input1': {
                'type': 'desktop',
                'display_num': 99,
                'video_size': '1920x1080',
                'framerate': 30,
                'has_video': True,
                'has_audio': False
            },
            'input2': {
                'type': 'alsa',
                'device': 'hw:Loopback,1,3',
                'has_video': False,
                'has_audio': True
            }
        }
        proc_paired.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac',
            'video_params': {},
            'audio_params': {}
        }
        proc_paired.filter_config = {}
        proc_paired.output_config = {
            'type': 'udp',
            'host': '239.0.0.1',
            'port': 1234
        }

        cmd_paired = self.pm._build_ffmpeg_cmd(proc_paired, "ffmpeg")
        cmd_str_paired = " ".join(cmd_paired)

        # Both inputs must be present
        self.assertIn("-f x11grab", cmd_str_paired)
        self.assertIn("-f alsa -i hw:Loopback,1,3", cmd_str_paired)
        # Maps video from input 0 and audio from input 1
        self.assertIn("-map 0:v", cmd_str_paired)
        self.assertIn("-map 1:a", cmd_str_paired)

    def test_rtsp_output_generation_audio_only_pcm(self):
        """Test audio-only RTSP push using TCP transport and uncompressed PCM."""
        proc = MagicMock()
        proc.type = "service"
        proc.input_config = {
            'type': 'alsa',
            'device': 'hw:0,0',
            'has_video': False,
            'has_audio': True
        }
        proc.codec_config = {
            'vcodec': 'none',
            'acodec': 'pcm_s16le',
            'video_params': {},
            'audio_params': {'ar': '48000', 'ac': '2'}
        }
        proc.filter_config = {}
        proc.output_config = {
            'type': 'rtsp',
            'host': '127.0.0.1',
            'port': '8554',
            'path_id': 'master_pcm',
            'rtsp_transport': 'tcp'
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-f alsa -i hw:0,0", cmd_str)
        self.assertIn("-vn", cmd_str)
        self.assertIn("-c:a pcm_s16le", cmd_str)
        self.assertIn("-rtsp_transport tcp", cmd_str)
        self.assertIn("-f rtsp rtsp://127.0.0.1:8554/master_pcm", cmd_str)

    def test_rtsp_output_generation_video_audio_with_credentials(self):
        """Test video + audio RTSP push with transport and authentication."""
        proc = MagicMock()
        proc.type = "service"
        proc.input_config = {
            'type': 'srt',
            'host': '127.0.0.1',
            'port': 9000,
            'has_video': True,
            'has_audio': True
        }
        proc.codec_config = {
            'vcodec': 'libx264',
            'acodec': 'aac',
            'video_params': {'b:v': '2500k'},
            'audio_params': {'b:a': '128k'}
        }
        proc.filter_config = {}
        proc.output_config = {
            'type': 'rtsp',
            'host': '192.168.1.100',
            'port': '8554',
            'path_id': 'studio/cam1',
            'publish_user': 'admin',
            'publish_pass': 'secret123',
            'rtsp_transport': 'udp'
        }

        cmd = self.pm._build_ffmpeg_cmd(proc, "ffmpeg")
        cmd_str = " ".join(cmd)

        self.assertIn("-c:v libx264", cmd_str)
        self.assertIn("-c:a aac", cmd_str)
        self.assertIn("-rtsp_transport udp", cmd_str)
        self.assertIn("-f rtsp rtsp://admin:secret123@192.168.1.100:8554/studio/cam1", cmd_str)


if __name__ == '__main__':
    unittest.main()

