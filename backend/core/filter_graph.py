import os
import re

class FilterGraphBuilder:
    @staticmethod
    def escape_filter_arg(val: str) -> str:
        # Escape backslashes and colons for FFmpeg filter arguments
        return val.replace('\\', '\\\\').replace(':', '\\:').replace("'", "'\\\\''")

    @classmethod
    def build_video_filters(cls, input_cfg: dict, filter_cfg: dict, is_vram: bool, hwaccel: str) -> tuple[str, bool]:
        """
        Compiles the video filters into a single FFmpeg filter graph string.
        Returns a tuple: (filter_graph_string, remains_in_vram)
        """
        linear_filters = []
        
        # 1. Deinterlacing
        if filter_cfg.get('deinterlace'):
            if is_vram:
                if hwaccel == 'vaapi':
                    linear_filters.append("deinterlace_vaapi")
                elif hwaccel == 'qsv':
                    linear_filters.append("vpp_qsv=deinterlace=2")
                elif hwaccel == 'cuda':
                    linear_filters.append("yadif_cuda")
                else:
                    linear_filters.append("yadif")
            else:
                linear_filters.append("yadif")
                
        # 2. Scaling
        if filter_cfg.get('scale'):
            scale_val = filter_cfg['scale'].replace('x', ':')
            # Extract width and height if needed for QSV
            parts = scale_val.split(':')
            w = parts[0] if len(parts) > 0 else '1280'
            h = parts[1] if len(parts) > 1 else '720'
            
            if is_vram:
                if hwaccel == 'vaapi':
                    linear_filters.append(f"scale_vaapi={scale_val}")
                elif hwaccel == 'qsv':
                    # If deinterlacing was already added for QSV, combine them into one vpp_qsv filter
                    # otherwise create a new one
                    qsv_idx = -1
                    for idx, f in enumerate(linear_filters):
                        if f.startswith("vpp_qsv"):
                            qsv_idx = idx
                            break
                    if qsv_idx != -1:
                        linear_filters[qsv_idx] += f":w={w}:h={h}"
                    else:
                        linear_filters.append(f"vpp_qsv=w={w}:h={h}")
                elif hwaccel == 'cuda':
                    linear_filters.append(f"scale_npp={scale_val}")
                else:
                    linear_filters.append(f"scale={scale_val}")
            else:
                linear_filters.append(f"scale={scale_val}")

        # Extract text overlays and image overlays
        overlays = filter_cfg.get('overlays', [])
        # Sort overlays by their configured order/z-index
        sorted_overlays = sorted(overlays, key=lambda x: x.get('order', 0))
        
        has_overlays = len(sorted_overlays) > 0
        
        # If overlays are present, they are CPU-bound, so we must download from VRAM if active
        if has_overlays and is_vram:
            linear_filters.append("hwdownload")
            linear_filters.append("format=nv12")
            is_vram = False

        # Build the filter graph string
        # We start with the linear filters (deinterlace, scale, text overlays)
        text_and_simple = []
        image_overlays = []
        
        for overlay in sorted_overlays:
            o_type = overlay.get('type')
            if o_type == 'text':
                text = cls.escape_filter_arg(overlay.get('text', ''))
                x = str(overlay.get('x', '0'))
                y = str(overlay.get('y', '0'))
                
                # Translate overlay filter expression variables (main_w, main_h) to drawtext variables (w, h, text_w, text_h)
                x_dt = x.replace('main_w-w', 'w-text_w').replace('main_w', 'w')
                y_dt = y.replace('main_h-h', 'h-text_h').replace('main_h', 'h')
                
                fontsize = overlay.get('fontsize', '24')
                fontcolor = overlay.get('fontcolor', 'white')
                
                dt_parts = [
                    f"drawtext=text='{text}'",
                    f"x={x_dt}",
                    f"y={y_dt}",
                    f"fontsize={fontsize}",
                    f"fontcolor={fontcolor}"
                ]
                
                if overlay.get('box'):
                    dt_parts.append("box=1")
                    if overlay.get('boxcolor'):
                        dt_parts.append(f"boxcolor={overlay.get('boxcolor')}")
                    if overlay.get('boxborderw'):
                        dt_parts.append(f"boxborderw={overlay.get('boxborderw')}")
                        
                text_and_simple.append(":".join(dt_parts))
            elif o_type == 'image':
                image_overlays.append(overlay)
                
        # Merge deinterlace, scale and text overlays
        all_linear = linear_filters + text_and_simple
        
        if not all_linear and not image_overlays:
            return "", is_vram
            
        if not image_overlays:
            return ",".join(all_linear), is_vram
            
        # If we have image overlays, we need to construct a labeled filter graph
        # Format: [in]linear1,linear2[vmain]; movie=logo.png[logo0]; [vmain][logo0]overlay=x:y[vmain]; ...
        graph = []
        current_label = "[in]"
        
        if all_linear:
            graph.append(f"[in]{','.join(all_linear)}[vmain]")
            current_label = "[vmain]"
            
        for idx, img in enumerate(image_overlays):
            path = cls.escape_filter_arg(img.get('path', ''))
            x = img.get('x', '0')
            y = img.get('y', '0')
            logo_label = f"[logo{idx}]"
            next_label = f"[vmain{idx}]"
            
            graph.append(f"movie='{path}'{logo_label}")
            if current_label == "[in]":
                graph.append(f"[in]{logo_label}overlay=x={x}:y={y}[vmain{idx}]")
            else:
                graph.append(f"{current_label}{logo_label}overlay=x={x}:y={y}[vmain{idx}]")
            current_label = next_label
            
        # The last label must be omitted at the end of the graph so it automatically outputs to the next stage
        # So we replace the last label assignment with nothing
        last_item = graph[-1]
        match = re.search(r'\[vmain\d+\]$', last_item)
        if match:
            graph[-1] = last_item[:match.start()]
            
        return ";".join(graph), is_vram

    @staticmethod
    def build_audio_filters(filter_cfg: dict) -> str:
        """
        Compiles the audio filters into a single FFmpeg filter chain string,
        following the professional audio signal chain order.
        """
        af = []
        
        # 1. Paso filters (Highpass / Lowpass)
        if filter_cfg.get('highpass'):
            af.append(f"highpass=f={filter_cfg['highpass']}")
        if filter_cfg.get('lowpass'):
            af.append(f"lowpass=f={filter_cfg['lowpass']}")
            
        # 2. Input Volume / Gain
        volume = filter_cfg.get('volume')
        audio_volume = filter_cfg.get('audio_volume')
        if volume:
            vol_str = str(volume)
            # If volume is a simple number (float/int), append 'dB' suffix
            if vol_str.replace('.', '', 1).replace('-', '', 1).isdigit():
                vol_str = f"{vol_str}dB"
            af.append(f"volume={vol_str}")
        elif audio_volume:
            vol_str = str(audio_volume)
            af.append(f"volume={vol_str}")
            
        # 3. Equalization (10-Band ISO Graphic EQ)
        eq = filter_cfg.get('equalizer', {})
        if eq.get('enabled') and eq.get('bands'):
            iso_bands = ["31.5", "63", "125", "250", "500", "1000", "2000", "4000", "8000", "16000"]
            for band in iso_bands:
                gain = eq['bands'].get(band, 0)
                if gain != 0:
                    # width_type=o, width=1 means 1-octave bandwidth peaking filter
                    af.append(f"equalizer=f={band}:width_type=o:width=1:g={gain}")
                    
        # 4. Dynamics (compand)
        comp = filter_cfg.get('compressor')
        if isinstance(comp, dict) and comp.get('enabled'):
            attack = comp.get('attack', 0.3)
            release = comp.get('release', 0.3)
            gate = comp.get('gate', -60)
            gate_ratio = comp.get('gate_ratio', 4)
            threshold = comp.get('threshold', -30)
            ratio = comp.get('ratio', 4)
            gain = comp.get('gain', 0)
            
            y_gate = gate
            y_thresh = threshold
            # Output at 0dBFS before gain
            y_zero = threshold + (0 - threshold) / ratio
            
            # Point 10dB below gate for expansion slope
            x_exp = gate - 10
            y_exp = gate - 10 * gate_ratio
            
            # Apply makeup gain to all nodes, clipping at 0dBFS ceiling
            y_exp_g = min(0.0, y_exp + gain)
            y_gate_g = min(0.0, y_gate + gain)
            y_thresh_g = min(0.0, y_thresh + gain)
            y_zero_g = min(0.0, y_zero + gain)
            
            # Format points string. Silence node (-900/-900) remains unchanged
            points_str = f"-900/-900|{x_exp}/{y_exp_g:.2f}|{gate}/{y_gate_g:.2f}|{threshold}/{y_thresh_g:.2f}|0/{y_zero_g:.2f}"
            af.append(f"compand=attacks={attack}:decays={release}:points={points_str}")
        elif comp is True:
            # Fallback legacy compressor
            af.append("compand=attacks=0.3:decays=0.3:points=-900/-900|-70/-110|-60/-60|-30/-30|0/-15")
            
        # 5. Output Brickwall Limiter
        limiter = filter_cfg.get('limiter', {})
        if limiter.get('enabled'):
            ceiling = limiter.get('ceiling', -0.1)
            rel_ms = limiter.get('release', 50)
            af.append(f"alimiter=limit={ceiling}dB:release={rel_ms}")
            
        # 6. Audio Resampling / Sync
        aresample = filter_cfg.get('aresample')
        if aresample:
            if isinstance(aresample, dict) and aresample.get('enabled'):
                mode = aresample.get('mode', 'basic')
                if mode == 'basic':
                    af.append("aresample=async=1")
                elif mode == 'advanced':
                    params = ["async=1"]
                    osr = aresample.get('osr')
                    if osr:
                        params.append(f"osr={osr}")
                    min_comp = aresample.get('min_comp')
                    if min_comp is not None:
                        params.append(f"min_comp={min_comp}")
                    min_hard_comp = aresample.get('min_hard_comp')
                    if min_hard_comp is not None:
                        params.append(f"min_hard_comp={min_hard_comp}")
                    af.append(f"aresample={':'.join(params)}")
            elif aresample is True:
                af.append("aresample=async=1")
                
        return ",".join(af) if af else ""
