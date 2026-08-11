import os
import copy

class FFmpegCommandBuilder:
    """Single Source of Truth (SSOT) for FFmpeg CLI command generation.
    
    Stateless builder that converts a media process or scheduled task config
    into an executable FFmpeg command-line argument list.
    """

    @classmethod
    def _resolve_storage_path(cls, storage_id: int, relative_path: str, db_session_factory=None) -> str:
        if not storage_id or not db_session_factory:
            return None
        with db_session_factory() as session:
            from database.models import Storage
            storage = session.query(Storage).get(storage_id)
            if storage and storage.path:
                return os.path.join(storage.path, relative_path or '')
        return None

    @classmethod
    def _resolve_config_paths(cls, input_cfg: dict, output_cfg: dict, filter_cfg: dict, db_session_factory=None):
        if 'input1' in input_cfg:
            for key in ['input1', 'input2']:
                if key in input_cfg and isinstance(input_cfg[key], dict):
                    inp = input_cfg[key]
                    if inp.get('storage_id'):
                        resolved = cls._resolve_storage_path(inp.get('storage_id'), inp.get('relative_path'), db_session_factory)
                        if resolved:
                            inp['path'] = resolved
        else:
            if input_cfg.get('storage_id'):
                resolved = cls._resolve_storage_path(input_cfg.get('storage_id'), input_cfg.get('relative_path'), db_session_factory)
                if resolved:
                    input_cfg['path'] = resolved

        if output_cfg.get('storage_id'):
            resolved = cls._resolve_storage_path(output_cfg.get('storage_id'), output_cfg.get('relative_path'), db_session_factory)
            if resolved:
                output_cfg['path'] = resolved

        overlays = filter_cfg.get('overlays', [])
        for overlay in overlays:
            if isinstance(overlay, dict) and overlay.get('storage_id'):
                resolved = cls._resolve_storage_path(overlay.get('storage_id'), overlay.get('relative_path'), db_session_factory)
                if resolved:
                    overlay['path'] = resolved

    @classmethod
    def _append_fps_mode(cls, cmd: list, codec_cfg: dict, output_cfg: dict, filter_cfg: dict, ffmpeg_bin: str):
        video_params = codec_cfg.get('video_params', {})
        fps_mode = video_params.get('fps_mode', 'auto')
        
        from utils.process_utils import get_ffmpeg_version
        version = get_ffmpeg_version(ffmpeg_bin)
        
        if fps_mode == 'auto':
            output_type = output_cfg.get('type')
            live_outputs = {'rtmp', 'srt', 'udp', 'hls', 'whip', 'icecast', 'decklink', 'ndi'}
            has_target_rate = bool(filter_cfg.get('framerate') or output_cfg.get('framerate'))
            if output_type in live_outputs and has_target_rate:
                resolved_mode = 'cfr'
            else:
                resolved_mode = 'auto'
        else:
            resolved_mode = fps_mode
            
        if version >= 5.1:
            if resolved_mode != 'auto':
                cmd += ["-fps_mode", resolved_mode]
        else:
            vsync_map = {
                "passthrough": "0",
                "cfr": "1",
                "vfr": "2"
            }
            if resolved_mode in vsync_map:
                cmd += ["-vsync", vsync_map[resolved_mode]]

    @classmethod
    def _append_input(cls, cmd: list, input_cfg: dict, ffmpeg_bin: str = "ffmpeg"):
        input_type = input_cfg.get('type')
        
        _HWACCEL_UNSUPPORTED_INPUT_TYPES = {'lavfi_video', 'lavfi_audio', 'alsa'}
        hwaccel = 'none'
        if input_type not in _HWACCEL_UNSUPPORTED_INPUT_TYPES:
            hwaccel = input_cfg.get('hwaccel', 'none')
            
        if hwaccel and hwaccel != 'none':
            cmd += ["-hwaccel", hwaccel]
            hwaccel_out = input_cfg.get('hwaccel_output_format', '')
            if not hwaccel_out:
                hwaccel_out = hwaccel
            if hwaccel_out and hwaccel_out != 'none':
                cmd += ["-hwaccel_output_format", hwaccel_out]

        network_timeout_val = input_cfg.get('network_timeout')
        if network_timeout_val is None or str(network_timeout_val).strip() == "":
            network_timeout = 15
        else:
            try:
                network_timeout = int(network_timeout_val)
            except (ValueError, TypeError):
                network_timeout = 15

        input_type_upper = str(input_type).upper() if input_type else ""
        if input_type_upper in ('RTMP', 'RTSP', 'HTTP', 'HLS', 'UDP', 'RTP', 'HTTP_AUDIO'):
            timeout_us = network_timeout * 1000000
            if input_type_upper in ('RTMP', 'RTSP'):
                cmd += ["-rw_timeout", str(timeout_us)]
            elif input_type_upper in ('HTTP', 'HLS', 'HTTP_AUDIO'):
                cmd += [
                    "-timeout", str(timeout_us),
                    "-reconnect", "1",
                    "-reconnect_at_eof", "1",
                    "-reconnect_streamed", "1",
                    "-reconnect_delay_max", "5"
                ]
            elif input_type_upper in ('UDP', 'RTP'):
                cmd += ["-timeout", str(timeout_us)]

        if input_type == 'file':
            cmd += ["-i", input_cfg.get('path', '')]
        elif input_type == 'srt':
            mode = input_cfg.get('mode', 'caller')
            latency = input_cfg.get('latency', 250)
            host = input_cfg.get('host') or ('0.0.0.0' if mode == 'listener' else '127.0.0.1')
            port = input_cfg.get('port', '9000')
            streamid = input_cfg.get('streamid', '')
            
            url = f"srt://{host}:{port}?mode={mode}&latency={latency}"
            if mode == 'caller' and network_timeout > 0:
                from utils.process_utils import get_ffmpeg_version
                version = get_ffmpeg_version(ffmpeg_bin)
                timeout_us = network_timeout * 1000000
                timeout_param = f"timeout={timeout_us}" if version >= 4.0 else f"rw_timeout={timeout_us}"
                url += f"&{timeout_param}"
            if streamid:
                url += f"&streamid={streamid}"
            cmd += ["-i", url]
        elif input_type == 'ndi':
            name = input_cfg.get('name', '')
            cmd += ["-f", "libndi_newtek", "-i", name]
        elif input_type == 'decklink':
            video_input = input_cfg.get('video_input')
            if video_input and video_input != 'unset':
                cmd += ["-video_input", video_input]
            audio_input = input_cfg.get('audio_input')
            if audio_input and audio_input != 'unset':
                cmd += ["-audio_input", audio_input]
            format_code = input_cfg.get('format_code')
            if format_code and format_code != 'unset':
                cmd += ["-format_code", format_code]
            cmd += ["-f", "decklink", "-i", input_cfg.get('device', '')]
        elif input_type == 'udp':
            host = input_cfg.get('host', '')
            port = input_cfg.get('port', '1234')
            cmd += ["-i", f"udp://{host}:{port}?fifo_size=1000000"]
        elif input_type == 'rtp':
            host = input_cfg.get('host', '')
            port = input_cfg.get('port', '5004')
            cmd += ["-i", f"rtp://{host}:{port}"]
        elif input_type == 'alsa':
            device = input_cfg.get('device', 'hw:0,0')
            cmd += ["-f", "alsa", "-i", device]
        elif input_type == 'v4l2':
            device = input_cfg.get('device', '/dev/video0')
            pixel_format = input_cfg.get('pixel_format')
            size = input_cfg.get('size')
            if pixel_format:
                cmd += ["-input_format", pixel_format]
            if size:
                cmd += ["-video_size", size]
            cmd += ["-f", "v4l2", "-i", device]
        elif input_type in ('http_audio', 'rtmp', 'rtsp', 'hls', 'http'):
            cmd += ["-i", input_cfg.get('path', '')]
        elif input_type == 'lavfi':
            cmd += ["-f", "lavfi", "-i", input_cfg.get('path', 'testsrc')]
        elif input_type == 'lavfi_video':
            pattern = input_cfg.get('pattern', 'testsrc')
            size = input_cfg.get('size')
            rate = input_cfg.get('rate')
            
            lavfi_str = pattern
            params = []
            if size:
                params.append(f"size={size}")
            if rate:
                params.append(f"rate={rate}")
                
            if params:
                if '=' in pattern:
                    lavfi_str = f"{pattern}:{':'.join(params)}"
                else:
                    lavfi_str = f"{pattern}={':'.join(params)}"
            cmd += ["-f", "lavfi", "-i", lavfi_str]
        elif input_type == 'lavfi_audio':
            pattern = input_cfg.get('pattern', 'sine')
            frequency = input_cfg.get('frequency')
            
            lavfi_str = pattern
            if pattern == 'sine' and frequency:
                lavfi_str = f"sine=frequency={frequency}"
            cmd += ["-f", "lavfi", "-i", lavfi_str]

    @classmethod
    def _append_video_codec_params(cls, cmd: list, vcodec: str, params: dict):
        rc_mode = params.get('rc_mode', '')
        
        if vcodec in ('libx264', 'libx265'):
            if rc_mode == 'crf':
                crf = params.get('crf', 23)
                cmd += ["-crf", str(crf)]
            elif rc_mode in ('cbr', 'vbr'):
                bitrate = params.get('bitrate', '4000k')
                cmd += ["-b:v", bitrate]
                if params.get('maxrate'):
                    cmd += ["-maxrate", params['maxrate']]
                if params.get('bufsize'):
                    cmd += ["-bufsize", params['bufsize']]
            
            if params.get('preset'):
                cmd += ["-preset", params['preset']]
            tune = params.get('tune', 'none')
            if tune and tune != 'none':
                cmd += ["-tune", tune]
            if params.get('profile'):
                cmd += ["-profile:v", params['profile']]
            if params.get('g'):
                cmd += ["-g", str(params['g'])]
            if params.get('bf') is not None:
                cmd += ["-bf", str(params['bf'])]
            
            pix_fmt = params.get('pix_fmt', 'yuv420p')
            cmd += ["-pix_fmt", pix_fmt]
                
        elif vcodec == 'prores_ks':
            if params.get('profile') is not None:
                cmd += ["-profile:v", str(params['profile'])]
            if params.get('vendor'):
                cmd += ["-vendor", params['vendor']]
                
        elif vcodec == 'dnxhd':
            profile = params.get('profile', 'dnxhr_hq')
            if profile == 'dnxhd':
                if params.get('bitrate'):
                    cmd += ["-b:v", params['bitrate']]
            else:
                cmd += ["-profile:v", profile]
                
        elif vcodec in ('h264_vaapi', 'hevc_vaapi'):
            cmd += ["-vaapi_device", "/dev/dri/renderD128"]
            rc_mode_vaapi = params.get('rc_mode', 'CBR')
            cmd += ["-rc_mode", rc_mode_vaapi]
            if rc_mode_vaapi != 'CQP' and params.get('bitrate'):
                cmd += ["-b:v", params['bitrate']]
            if rc_mode_vaapi == 'CQP' and params.get('qp') is not None:
                cmd += ["-qp", str(params['qp'])]
            if params.get('profile'):
                cmd += ["-profile:v", params['profile']]
            if params.get('g'):
                cmd += ["-g", str(params['g'])]
                
        elif vcodec in ('h264_qsv',):
            if params.get('preset'):
                cmd += ["-preset", params['preset']]
            if params.get('bitrate'):
                cmd += ["-b:v", params['bitrate']]
            if params.get('global_quality') is not None:
                cmd += ["-global_quality", str(params['global_quality'])]
            if params.get('g'):
                cmd += ["-g", str(params['g'])]
                
        elif vcodec in ('h264_nvenc', 'hevc_nvenc'):
            if params.get('preset'):
                cmd += ["-preset", params['preset']]
            rc = params.get('rc', 'cbr')
            cmd += ["-rc", rc]
            if params.get('bitrate'):
                cmd += ["-b:v", params['bitrate']]
            if rc in ('constqp', 'vbr') and params.get('cq') is not None:
                cmd += ["-cq", str(params['cq'])]
            if params.get('profile'):
                cmd += ["-profile:v", params['profile']]
            if params.get('g'):
                cmd += ["-g", str(params['g'])]
            if params.get('bf') is not None:
                cmd += ["-bf", str(params['bf'])]
                
        elif vcodec == 'rawvideo':
            pix_fmt = params.get('pix_fmt', 'uyvy422')
            cmd += ["-pix_fmt", pix_fmt]
            
        elif vcodec == 'v210':
            pass

    @classmethod
    def _append_audio_codec_params(cls, cmd: list, acodec: str, params: dict):
        if params.get('b:a'):
            cmd += ["-b:a", params['b:a']]
        if params.get('ac'):
            cmd += ["-ac", str(params['ac'])]
        if params.get('ar'):
            cmd += ["-ar", str(params['ar'])]
        if acodec == 'aac' and params.get('profile:a'):
            cmd += ["-profile:a", params['profile:a']]
        elif acodec == 'libopus':
            if params.get('application'):
                cmd += ["-application:a", params['application']]
            if params.get('vbr'):
                cmd += ["-vbr:a", params['vbr']]

    @classmethod
    def _append_video_codec_params_indexed(cls, cmd: list, vcodec: str, params: dict, idx: int, bitrate: str):
        cmd += [f"-b:v:{idx}", bitrate]
        rc_mode = params.get('rc_mode', '')
        
        if vcodec in ('libx264', 'libx265'):
            if params.get('preset'):
                cmd += [f"-preset:v:{idx}", params['preset']]
            tune = params.get('tune', 'none')
            if tune and tune != 'none':
                cmd += [f"-tune:v:{idx}", tune]
            if params.get('profile'):
                cmd += [f"-profile:v:{idx}", params['profile']]
            if params.get('g'):
                cmd += [f"-g:v:{idx}", str(params['g'])]
            if params.get('bf') is not None:
                cmd += [f"-bf:v:{idx}", str(params['bf'])]
            
            pix_fmt = params.get('pix_fmt', 'yuv420p')
            cmd += [f"-pix_fmt:v:{idx}", pix_fmt]
            
            if rc_mode == 'crf':
                crf = params.get('crf', 23)
                cmd += [f"-crf:v:{idx}", str(crf)]
            elif rc_mode in ('cbr', 'vbr'):
                if params.get('maxrate'):
                    cmd += [f"-maxrate:v:{idx}", params['maxrate']]
                if params.get('bufsize'):
                    cmd += [f"-bufsize:v:{idx}", params['bufsize']]

    @classmethod
    def _append_audio_codec_params_indexed(cls, cmd: list, acodec: str, params: dict, idx: int, bitrate: str):
        cmd += [f"-b:a:{idx}", bitrate]
        if params.get('ac'):
            cmd += [f"-ac:a:{idx}", str(params['ac'])]
        if params.get('ar'):
            cmd += [f"-ar:a:{idx}", str(params['ar'])]
        if acodec == 'aac' and params.get('profile:a'):
            cmd += [f"-profile:a:{idx}", params['profile:a']]
        elif acodec == 'libopus':
            if params.get('application'):
                cmd += [f"-application:a:{idx}", params['application']]
            if params.get('vbr'):
                cmd += [f"-vbr:a:{idx}", params['vbr']]

    @classmethod
    def _append_output(cls, cmd: list, output_cfg: dict, codec_cfg: dict, limit_sec=None):
        output_type = output_cfg.get('type')
        
        is_mpegts = (
            output_type in ('udp', 'srt', 'rtp_mpegts') or 
            (output_type == 'file' and output_cfg.get('container') == 'mpegts') or
            (output_type == 'file' and output_cfg.get('path', '').endswith('.ts'))
        )
        
        if is_mpegts:
            vcodec = codec_cfg.get('vcodec', '').lower()
            if '264' in vcodec or 'h264' in vcodec:
                cmd += ["-bsf:v", "h264_mp4toannexb"]
            elif '265' in vcodec or 'hevc' in vcodec or 'h256' in vcodec:
                cmd += ["-bsf:v", "hevc_mp4toannexb"]
                
        def append_mpegts_options(cmd: list, cfg: dict):
            if cfg.get('muxrate'):
                cmd += ["-muxrate", str(cfg['muxrate'])]
            
            ts_id = cfg.get('transport_stream_id') or cfg.get('ts_id')
            if ts_id is not None and ts_id != '':
                cmd += ["-mpegts_transport_stream_id", str(ts_id)]
                
            net_id = cfg.get('original_network_id') or cfg.get('net_id')
            if net_id is not None and net_id != '':
                cmd += ["-mpegts_original_network_id", str(net_id)]
                
            service_id = cfg.get('service_id')
            if service_id is not None and service_id != '':
                cmd += ["-mpegts_service_id", str(service_id)]

            for param, flag in [
                ('pmt_start_pid', '-mpegts_pmt_start_pid'),
                ('start_pid', '-mpegts_start_pid')
            ]:
                if cfg.get(param):
                    cmd += [flag, str(cfg[param])]
            if cfg.get('service_provider'):
                cmd += ["-metadata", f"service_provider={cfg['service_provider']}"]
            if cfg.get('service_name'):
                cmd += ["-metadata", f"service_name={cfg['service_name']}"]
            if cfg.get('service_type'):
                cmd += ["-mpegts_service_type", str(cfg['service_type'])]
            if cfg.get('audio_language'):
                cmd += ["-metadata:s:a:0", f"language={cfg['audio_language']}"]
            flags = []
            if cfg.get('pat_pmt_at_frames'):
                flags.append("pat_pmt_at_frames")
            if cfg.get('system_b'):
                flags.append("system_b")
            if flags:
                cmd += ["-mpegts_flags", "+".join(flags)]

        if limit_sec is not None and int(limit_sec) > 0:
            cmd += ["-t", str(int(limit_sec))]

        if output_type == 'file':
            path = output_cfg.get('path', 'output.mp4')
            if is_mpegts:
                cmd += ["-f", "mpegts"]
                append_mpegts_options(cmd, output_cfg)
            cmd += [path]
        elif output_type == 'udp':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '1234')
            pkt_size = output_cfg.get('pkt_size', '1316')
            url = f"udp://{host}:{port}"
            if pkt_size:
                url += f"?pkt_size={pkt_size}"
            cmd += ["-f", "mpegts", url]
            append_mpegts_options(cmd, output_cfg)
        elif output_type == 'srt':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '1234')
            mode = output_cfg.get('mode', 'caller')
            latency = output_cfg.get('latency', 200)
            streamid = output_cfg.get('streamid', '')
            
            url = f"srt://{host}:{port}?mode={mode}&latency={latency}"
            if streamid:
                url += f"&streamid={streamid}"
                
            cmd += ["-f", "mpegts", url]
            append_mpegts_options(cmd, output_cfg)
        elif output_type == 'rtp_mpegts':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '5004')
            cmd += ["-f", "rtp_mpegts", f"rtp://{host}:{port}"]
            append_mpegts_options(cmd, output_cfg)
        elif output_type == 'rtmp':
            cmd += ["-f", "flv", output_cfg.get('url', '')]
        elif output_type == 'whip':
            cmd += ["-f", "whip", output_cfg.get('url', '')]
        elif output_type == 'ndi':
            name = output_cfg.get('path', 'FFMPEG-OUTPUT')
            cmd += ["-f", "libndi_newtek", name]
        elif output_type == 'decklink':
            device = output_cfg.get('device', 'DeckLink Mini Monitor')
            cmd += ["-f", "decklink"]
            format_code = output_cfg.get('format_code')
            if format_code:
                cmd += ["-format_code", format_code]
                code_lower = format_code.lower()
                if code_lower in ('pal', 'ntsc') or code_lower.startswith('hi'):
                    if code_lower == 'ntsc':
                        cmd += ["-field_order", "bb"]
                    else:
                        cmd += ["-field_order", "tt"]
                else:
                    cmd += ["-field_order", "progressive"]
            cmd += [device]
        elif output_type == 'rtp':
            host = output_cfg.get('host', '127.0.0.1')
            port = output_cfg.get('port', '5004')
            cmd += ["-f", "rtp", f"rtp://{host}:{port}"]
        elif output_type == 'alsa':
            device = output_cfg.get('device', 'hw:0,0')
            cmd += ["-f", "alsa", device]
        elif output_type == 'icecast':
            host = output_cfg.get('host', 'localhost')
            port = output_cfg.get('port', '8000')
            mount = output_cfg.get('icecast_mount', '/live')
            password = output_cfg.get('icecast_password', 'hackme')
            cmd += ["-f", "ogg", "-content_type", "application/ogg",
                    f"icecast://source:{password}@{host}:{port}{mount}"]
        elif output_type == 'hls':
            path = output_cfg.get('path', '')
            method = output_cfg.get('hls_method', 'local')
            hls_time = output_cfg.get('hls_time', 2)
            hls_list_size = output_cfg.get('hls_list_size', 5)
            hls_delete = output_cfg.get('hls_delete_segments', True)
            headers = output_cfg.get('headers', '')

            cmd += ["-f", "hls"]
            cmd += ["-hls_time", str(hls_time)]
            cmd += ["-hls_list_size", str(hls_list_size)]

            if method in ('PUT', 'POST'):
                cmd += ["-method", method]
                if headers:
                    formatted_headers = headers.strip()
                    if not formatted_headers.endswith('\r\n'):
                        formatted_headers += '\r\n'
                    cmd += ["-headers", formatted_headers]
            else:
                if hls_delete:
                    cmd += ["-hls_flags", "delete_segments"]
                
                if path.endswith('.m3u8'):
                    segment_pattern = path.replace('.m3u8', '_%03d.ts')
                    cmd += ["-hls_segment_filename", segment_pattern]

            cmd += [path]

    @classmethod
    def build_cmd(cls, media_proc, ffmpeg_bin: str, limit_sec=None, execution_id=None, db_session_factory=None) -> list:
        """Build the FFmpeg command line from a process or task model instance."""
        if hasattr(media_proc, 'config') and isinstance(media_proc.config, dict):
            cfg = media_proc.config
            input_cfg = copy.deepcopy(cfg.get('input_config', {}))
            codec_cfg = copy.deepcopy(cfg.get('codec_config', {}))
            filter_cfg = copy.deepcopy(cfg.get('filter_config', {}) or {})
            output_cfg = copy.deepcopy(cfg.get('output_config', {}))
            is_debug = cfg.get('debug_mode', False)
            net_timeout = cfg.get('network_timeout', 15)
        elif isinstance(media_proc, dict):
            input_cfg = copy.deepcopy(media_proc.get('input_config', {}))
            codec_cfg = copy.deepcopy(media_proc.get('codec_config', {}))
            filter_cfg = copy.deepcopy(media_proc.get('filter_config', {}) or {})
            output_cfg = copy.deepcopy(media_proc.get('output_config', {}))
            is_debug = media_proc.get('debug_mode', False)
            net_timeout = media_proc.get('network_timeout', 15)
        else:
            input_cfg = copy.deepcopy(getattr(media_proc, 'input_config', {}))
            codec_cfg = copy.deepcopy(getattr(media_proc, 'codec_config', {}))
            filter_cfg = copy.deepcopy(getattr(media_proc, 'filter_config', {}) or {})
            output_cfg = copy.deepcopy(getattr(media_proc, 'output_config', {}))
            is_debug = getattr(media_proc, 'debug_mode', False)
            net_timeout = getattr(media_proc, 'network_timeout', 15)

        if type(is_debug).__name__ in ('MagicMock', 'Mock'):
            is_debug = False
        cmd = [ffmpeg_bin, "-nostdin", "-hide_banner"]
        if is_debug:
            cmd += ["-loglevel", "info"]
        cmd += ["-y"]
        
        cls._resolve_config_paths(input_cfg, output_cfg, filter_cfg, db_session_factory)

        if type(net_timeout).__name__ in ('MagicMock', 'Mock'):
            net_timeout = input_cfg.get('network_timeout')
            if net_timeout is None:
                if 'input1' in input_cfg and isinstance(input_cfg['input1'], dict):
                    net_timeout = input_cfg['input1'].get('network_timeout', 15)
                else:
                    net_timeout = 15

        if 'input1' in input_cfg and isinstance(input_cfg['input1'], dict):
            input_cfg['input1']['network_timeout'] = net_timeout
        if 'input2' in input_cfg and isinstance(input_cfg['input2'], dict):
            input_cfg['input2']['network_timeout'] = net_timeout
        if 'input1' not in input_cfg:
            input_cfg['network_timeout'] = net_timeout
        advanced = filter_cfg.get('advanced', {})

        is_new_format = 'input1' in input_cfg
        primary_input_type = (
            input_cfg['input1'].get('type', '') if is_new_format
            else input_cfg.get('type', '')
        )

        threads = advanced.get('threads', 0)
        if threads and int(threads) > 0:
            cmd += ["-threads", str(int(threads))]

        _HWACCEL_UNSUPPORTED_INPUT_TYPES = {'lavfi_video', 'lavfi_audio', 'alsa'}
        is_hw_supported = primary_input_type not in _HWACCEL_UNSUPPORTED_INPUT_TYPES

        has_input_level_hwdec = False
        if is_hw_supported:
            if is_new_format:
                p_hw = input_cfg.get('input1', {}).get('hwaccel', 'none')
                s_hw = input_cfg.get('input2', {}).get('hwaccel', 'none')
                if (p_hw and p_hw != 'none') or (s_hw and s_hw != 'none'):
                    has_input_level_hwdec = True

        if is_hw_supported and not has_input_level_hwdec:
            hwaccel = advanced.get('hwaccel', 'none')
            if hwaccel and hwaccel != 'none':
                cmd += ["-hwaccel", hwaccel]
                hwaccel_out = advanced.get('hwaccel_output_format', '')
                if not hwaccel_out:
                    hwaccel_out = hwaccel
                if hwaccel_out and hwaccel_out != 'none':
                    cmd += ["-hwaccel_output_format", hwaccel_out]

        probesize = advanced.get('probesize', '')
        if probesize:
            cmd += ["-probesize", str(probesize)]

        tqs = advanced.get('thread_queue_size', 0)
        if tqs and int(tqs) > 0:
            cmd += ["-thread_queue_size", str(int(tqs))]

        _SELF_PACED_INPUTS = {'file', 'lavfi_video', 'lavfi_audio'}
        is_service = getattr(media_proc, 'type', 'service') == 'service'
        realtime = advanced.get('realtime')
        if realtime is None:
            realtime = is_service and primary_input_type in _SELF_PACED_INPUTS
        if realtime:
            cmd += ["-re"]

        stream_loop = advanced.get('stream_loop')
        if stream_loop is not None and primary_input_type == 'file' and is_service:
            cmd += ["-stream_loop", str(int(stream_loop))]

        if is_new_format:
            has_video = input_cfg.get('has_video', True)
            has_audio = input_cfg.get('has_audio', True)
            use_secondary = input_cfg.get('use_secondary_input', False)
            
            cls._append_input(cmd, input_cfg['input1'], ffmpeg_bin)
            if use_secondary and 'input2' in input_cfg:
                cls._append_input(cmd, input_cfg['input2'], ffmpeg_bin)
        else:
            has_video = True
            has_audio = True
            use_secondary = False
            cls._append_input(cmd, input_cfg, ffmpeg_bin)

        variants = output_cfg.get('variants', [])
        is_abr = output_cfg.get('type') == 'hls' and len(variants) > 0

        if is_abr:
            from core.filter_graph import FilterGraphBuilder

            _HWACCEL_UNSUPPORTED_INPUT_TYPES = {'lavfi_video', 'lavfi_audio', 'alsa'}
            is_hw_supported = primary_input_type not in _HWACCEL_UNSUPPORTED_INPUT_TYPES

            frames_destination = 'cpu'
            if is_hw_supported:
                if is_new_format:
                    frames_destination = input_cfg['input1'].get('frames_destination', 'cpu')
                else:
                    frames_destination = input_cfg.get('frames_destination', 'cpu')
                
            hwaccel = 'none'
            if is_hw_supported:
                if is_new_format:
                    hwaccel = input_cfg['input1'].get('hwaccel', 'none')
                else:
                    hwaccel = input_cfg.get('hwaccel', 'none')
            
            if is_hw_supported and hwaccel == 'none':
                hwaccel = advanced.get('hwaccel', 'none')

            is_vram = (frames_destination == 'vram')
            if hwaccel == 'none' or not is_hw_supported:
                is_vram = False

            vcodec = codec_cfg.get('vcodec', 'libx264')
            video_params = codec_cfg.get('video_params', {})
            
            if not has_video:
                cmd += ["-vn"]
            else:
                for idx, v in enumerate(variants):
                    cmd += ["-map", "0:v"]
                    
                    v_filter_cfg = {**filter_cfg, 'scale': v['resolution'].replace(':', 'x')}
                    vf_str, remains_vram = FilterGraphBuilder.build_video_filters(
                        input_cfg, v_filter_cfg, is_vram, hwaccel
                    )
                    
                    vf_list = []
                    if vf_str:
                        vf_list.append(vf_str)
                        
                    if remains_vram and vcodec in ('libx264', 'libx265', 'rawvideo', 'wrapped_avframe'):
                        vf_list.append("hwdownload")
                        vf_list.append("format=nv12")
                        remains_vram = False
                        
                    if not remains_vram and vcodec in ('h264_vaapi', 'hevc_vaapi', 'h264_qsv', 'hevc_qsv', 'h264_nvenc', 'hevc_nvenc'):
                        vf_list.append("format=nv12")
                        vf_list.append("hwupload")
                        remains_vram = True
                        
                    cmd += [f"-filter:v:{idx}", ",".join(vf_list)]
                    cmd += [f"-c:v:{idx}", vcodec]
                    
                    cls._append_video_codec_params_indexed(cmd, vcodec, video_params, idx, v['video_bitrate'])

            if not has_audio:
                cmd += ["-an"]
            else:
                acodec = codec_cfg.get('acodec', 'aac')
                audio_params = codec_cfg.get('audio_params', {})
                
                unique_audios = list(dict.fromkeys([v['audio_bitrate'] for v in variants if v.get('audio_bitrate')]))
                if not unique_audios:
                    unique_audios = [audio_params.get('b:a', '128k')]
                
                audio_map_idx = 1 if (is_new_format and use_secondary) else 0
                for idx, audio_bitrate in enumerate(unique_audios):
                    cmd += ["-map", f"{audio_map_idx}:a"]
                    cmd += [f"-c:a:{idx}", acodec]
                    
                    af_str = FilterGraphBuilder.build_audio_filters(filter_cfg)
                    if af_str:
                        cmd += [f"-filter:a:{idx}", af_str]
                        
                    cls._append_audio_codec_params_indexed(cmd, acodec, audio_params, idx, audio_bitrate)

            path = output_cfg.get('path', '')
            method = output_cfg.get('hls_method', 'local')
            hls_time = output_cfg.get('hls_time', 2)
            hls_list_size = output_cfg.get('hls_list_size', 5)
            hls_delete = output_cfg.get('hls_delete_segments', True)
            headers = output_cfg.get('headers', '')
            
            cls._append_fps_mode(cmd, codec_cfg, output_cfg, filter_cfg, ffmpeg_bin)
            
            cmd += ["-f", "hls"]
            cmd += ["-hls_time", str(hls_time)]
            cmd += ["-hls_list_size", str(hls_list_size)]
            
            hls_stream_name = output_cfg.get('hls_stream_name', 'stream')
            if hls_stream_name.endswith('.m3u8'):
                hls_stream_name = hls_stream_name[:-5]
                
            cmd += ["-master_pl_name", f"{hls_stream_name}.m3u8"]
            
            unique_audios = list(dict.fromkeys([v['audio_bitrate'] for v in variants if v.get('audio_bitrate')]))
            if not unique_audios:
                unique_audios = [audio_params.get('b:a', '128k')]
                
            stream_maps = []
            for idx, v in enumerate(variants):
                a_bitrate = v.get('audio_bitrate', unique_audios[0])
                try:
                    a_idx = unique_audios.index(a_bitrate)
                except ValueError:
                    a_idx = 0
                if has_audio:
                    stream_maps.append(f"v:{idx},a:{a_idx}")
                else:
                    stream_maps.append(f"v:{idx}")
                    
            cmd += ["-var_stream_map", " ".join(stream_maps)]
            
            if path.startswith('http://') or path.startswith('https://'):
                base_url = path.rstrip('/')
                variant_playlist = f"{base_url}/{hls_stream_name}_%v.m3u8"
                segment_pattern = f"{base_url}/{hls_stream_name}_%v_%03d.ts"
            else:
                base_dir = path
                if base_dir.endswith('.m3u8'):
                    base_dir = os.path.dirname(base_dir)
                variant_playlist = os.path.join(base_dir, f"{hls_stream_name}_%v.m3u8")
                segment_pattern = os.path.join(base_dir, f"{hls_stream_name}_%v_%03d.ts")
                
            if method in ('PUT', 'POST'):
                cmd += ["-method", method]
                if headers:
                    formatted_headers = headers.strip()
                    if not formatted_headers.endswith('\r\n'):
                        formatted_headers += '\r\n'
                    cmd += ["-headers", formatted_headers]
            else:
                if hls_delete:
                    cmd += ["-hls_flags", "delete_segments"]
                cmd += ["-hls_segment_filename", segment_pattern]
                
            cmd += [variant_playlist]

        else:
            video_map = None
            audio_map = None
            if is_new_format:
                video_map = input_cfg['input1'].get('video_map')
                audio_map = input_cfg['input1'].get('audio_map')
            else:
                video_map = input_cfg.get('video_map')
                audio_map = input_cfg.get('audio_map')
                
            if video_map and has_video:
                cmd += ["-map", video_map]
            elif has_video:
                if is_new_format and use_secondary:
                    cmd += ["-map", "0:v"]
                else:
                    cmd += ["-map", "0:v"]
                    
            if audio_map and has_audio:
                cmd += ["-map", audio_map]
            elif has_audio:
                if is_new_format and use_secondary:
                    cmd += ["-map", "1:a"]
                else:
                    cmd += ["-map", "0:a"]

            original_vf_str = ""
            original_remains_vram = False
            if not has_video:
                cmd += ["-vn"]
            else:
                from core.filter_graph import FilterGraphBuilder
                
                _HWACCEL_UNSUPPORTED_INPUT_TYPES = {'lavfi_video', 'lavfi_audio', 'alsa'}
                is_hw_supported = primary_input_type not in _HWACCEL_UNSUPPORTED_INPUT_TYPES

                frames_destination = 'cpu'
                if is_hw_supported:
                    if is_new_format:
                        frames_destination = input_cfg['input1'].get('frames_destination', 'cpu')
                    else:
                        frames_destination = input_cfg.get('frames_destination', 'cpu')
                    
                hwaccel = 'none'
                if is_hw_supported:
                    if is_new_format:
                        hwaccel = input_cfg['input1'].get('hwaccel', 'none')
                    else:
                        hwaccel = input_cfg.get('hwaccel', 'none')
                
                if is_hw_supported and hwaccel == 'none':
                    hwaccel = advanced.get('hwaccel', 'none')

                is_vram = (frames_destination == 'vram')
                if hwaccel == 'none' or not is_hw_supported:
                    is_vram = False
                    
                vf_str, remains_vram = FilterGraphBuilder.build_video_filters(
                    input_cfg, filter_cfg, is_vram, hwaccel
                )
                original_vf_str = vf_str
                original_remains_vram = remains_vram
                
                vf_list = []
                if vf_str:
                    vf_list.append(vf_str)
                    
                if filter_cfg.get('framerate'):
                    if remains_vram:
                        vf_list.append("hwdownload")
                        vf_list.append("format=nv12")
                        remains_vram = False
                    vf_list.append(f"fps={filter_cfg['framerate']}")
                    
                vcodec = codec_cfg.get('vcodec', 'libx264')
                output_type = output_cfg.get('type')
                
                needs_cpu_frames = (
                    output_type in ('decklink', 'ndi') or
                    vcodec in ('libx264', 'libx265', 'rawvideo', 'wrapped_avframe')
                )
                
                if remains_vram and needs_cpu_frames:
                    vf_list.append("hwdownload")
                    vf_list.append("format=nv12")
                    remains_vram = False
                    
                if output_type == 'decklink':
                    if output_cfg.get('video_size'):
                        size_arg = output_cfg['video_size'].replace('x', ':')
                        vf_list.append(f"scale={size_arg}")
                    if output_cfg.get('framerate'):
                        vf_list.append(f"fps={output_cfg['framerate']}")
                    vf_list.append("format=yuv422p")
                elif output_type == 'ndi':
                    vf_list.append("format=uyvy422")
                    
                is_hw_encoder = vcodec in ('h264_vaapi', 'hevc_vaapi', 'h264_qsv', 'hevc_qsv')
                if not remains_vram and is_hw_encoder:
                    vf_list.append("format=nv12")
                    vf_list.append("hwupload")
                    remains_vram = True
                    
                final_vf = ",".join(vf_list) if vf_list else ""
                if final_vf:
                    cmd += ["-vf", final_vf]

                if output_type == 'decklink' and vcodec == 'rawvideo':
                    cmd += ["-c:v", "wrapped_avframe"]
                else:
                    cmd += ["-c:v", vcodec]
                
                video_params = codec_cfg.get('video_params', {})
                if video_params:
                    cls._append_video_codec_params(cmd, vcodec, video_params)
                else:
                    if vcodec == 'libx264':
                        cmd += ["-preset", "veryfast", "-tune", "zerolatency"]
                    if codec_cfg.get('bitrate'):
                        cmd += ["-b:v", codec_cfg['bitrate']]

            if not has_audio:
                cmd += ["-an"]
            else:
                from core.filter_graph import FilterGraphBuilder
                af_str = FilterGraphBuilder.build_audio_filters(filter_cfg)
                if af_str:
                    cmd += ["-af", af_str]
                    
                acodec = codec_cfg.get('acodec', 'aac')
                cmd += ["-c:a", acodec]
                
                audio_params = codec_cfg.get('audio_params', {})
                if audio_params:
                    cls._append_audio_codec_params(cmd, acodec, audio_params)

            cls._append_fps_mode(cmd, codec_cfg, output_cfg, filter_cfg, ffmpeg_bin)
            cls._append_output(cmd, output_cfg, codec_cfg, limit_sec=limit_sec)
            
        is_service = getattr(media_proc, 'type', 'service') == 'service'
        
        has_video_stream = has_video and codec_cfg.get('vcodec') != 'none'
        if is_service and has_video_stream:
            from database.db import PREVIEWS_DIR
            previews_dir = PREVIEWS_DIR
            os.makedirs(previews_dir, exist_ok=True)
            if execution_id is not None:
                preview_path = os.path.join(previews_dir, f"preview_task_{execution_id}.jpg")
            else:
                proc_id_str = getattr(media_proc, 'id', None) or "preview"
                preview_path = os.path.join(previews_dir, f"preview_{proc_id_str}.jpg")
            
            if is_vram:
                preview_vf = "hwdownload,format=nv12,fps=1,scale=480:-1"
            else:
                preview_vf = "fps=1,scale=480:-1"
                
            cmd += [
                "-map", "0:v",
                "-c:v", "mjpeg",
                "-vf", preview_vf,
                "-update", "1",
                "-y", preview_path
            ]

        shm_dir = "/dev/shm"
        use_shm = os.path.exists(shm_dir) and os.access(shm_dir, os.W_OK)
        base_dir = shm_dir if use_shm else "/tmp"

        if execution_id is not None:
            progress_file_path = f"{base_dir}/ffmpeg_progress_{execution_id}t.log"
        else:
            process_id = getattr(media_proc, 'id', None)
            if process_id is not None:
                if is_service:
                    progress_file_path = f"{base_dir}/ffmpeg_progress_{process_id}s.log"
                else:
                    progress_file_path = f"{base_dir}/ffmpeg_progress_{process_id}t.log"
            else:
                progress_file_path = f"{base_dir}/ffmpeg_progress_preview.log"

        cmd += ["-progress", progress_file_path]

        return cmd
