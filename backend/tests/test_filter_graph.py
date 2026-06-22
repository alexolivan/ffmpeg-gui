import unittest
import sys
import os

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from core.filter_graph import FilterGraphBuilder

class TestFilterGraphBuilder(unittest.TestCase):
    def test_cpu_video_filters(self):
        filter_cfg = {'scale': '1280x720', 'deinterlace': True}
        vf, remains_vram = FilterGraphBuilder.build_video_filters({}, filter_cfg, is_vram=False, hwaccel='none')
        self.assertEqual(vf, "yadif,scale=1280:720")
        self.assertFalse(remains_vram)

    def test_cuda_vram_filters(self):
        filter_cfg = {'scale': '1920x1080', 'deinterlace': True}
        vf, remains_vram = FilterGraphBuilder.build_video_filters({}, filter_cfg, is_vram=True, hwaccel='cuda')
        self.assertEqual(vf, "yadif_cuda,scale_npp=1920:1080")
        self.assertTrue(remains_vram)

    def test_qsv_combined_filters(self):
        filter_cfg = {'scale': '720x576', 'deinterlace': True}
        vf, remains_vram = FilterGraphBuilder.build_video_filters({}, filter_cfg, is_vram=True, hwaccel='qsv')
        self.assertEqual(vf, "vpp_qsv=deinterlace=2:w=720:h=576")
        self.assertTrue(remains_vram)

    def test_vram_to_cpu_overlay_download(self):
        filter_cfg = {
            'scale': '1280x720',
            'overlays': [{'type': 'text', 'text': 'Hello World', 'x': '10', 'y': '10', 'fontsize': '30', 'fontcolor': 'red', 'order': 1}]
        }
        vf, remains_vram = FilterGraphBuilder.build_video_filters({}, filter_cfg, is_vram=True, hwaccel='cuda')
        self.assertEqual(vf, "scale_npp=1280:720,hwdownload,format=nv12,drawtext=text='Hello World':x=10:y=10:fontsize=30:fontcolor=red")
        self.assertFalse(remains_vram)

    def test_image_overlay_labeled_graph(self):
        filter_cfg = {
            'scale': '1280x720',
            'overlays': [
                {'type': 'image', 'path': '/path/to/logo.png', 'x': '15', 'y': '15', 'order': 1},
                {'type': 'text', 'text': 'Live', 'x': '100', 'y': '20', 'order': 0}
            ]
        }
        vf, remains_vram = FilterGraphBuilder.build_video_filters({}, filter_cfg, is_vram=False, hwaccel='none')
        # Expect text overlay in linear, then image overlay using movie and labeled graph
        # "[in]scale=1280:720,drawtext=text='Live':x=100:y=20[vmain];movie='/path/to/logo.png'[logo0];[vmain][logo0]overlay=x=15:y=15"
        self.assertIn("scale=1280:720,drawtext=text='Live':x=100:y=20", vf)
        self.assertIn("movie='/path/to/logo.png'", vf)
        self.assertIn("overlay=x=15:y=15", vf)

    def test_audio_filters(self):
        filter_cfg = {
            'highpass': '100',
            'lowpass': '15000',
            'equalizer': {
                'enabled': True,
                'bands': {'1000': '3', '2000': '-2'}
            },
            'compressor': True,
            'volume': '1.5',
            'aresample': True
        }
        af = FilterGraphBuilder.build_audio_filters(filter_cfg)
        self.assertIn("highpass=f=100", af)
        self.assertIn("lowpass=f=15000", af)
        self.assertIn("equalizer=f=1000:width_type=o:width=2:g=3", af)
        self.assertIn("equalizer=f=2000:width_type=o:width=2:g=-2", af)
        self.assertIn("compand=", af)
        self.assertIn("volume=1.5", af)
        self.assertIn("aresample=async=1", af)

if __name__ == '__main__':
    unittest.main()
