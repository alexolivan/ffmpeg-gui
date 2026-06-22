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
                x = overlay.get('x', '0')
                y = overlay.get('y', '0')
                fontsize = overlay.get('fontsize', '24')
                fontcolor = overlay.get('fontcolor', 'white')
                text_and_simple.append(f"drawtext=text='{text}':x={x}:y={y}:fontsize={fontsize}:fontcolor={fontcolor}")
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
        Compiles the audio filters into a single FFmpeg filter chain string.
        """
        af = []
        # 1. Paso filters
        if filter_cfg.get('highpass'):
            af.append(f"highpass=f={filter_cfg['highpass']}")
        if filter_cfg.get('lowpass'):
            af.append(f"lowpass=f={filter_cfg['lowpass']}")
        # 2. Equalization
        eq = filter_cfg.get('equalizer', {})
        if eq.get('enabled') and eq.get('bands'):
            for band, gain in eq['bands'].items():
                af.append(f"equalizer=f={band}:width_type=o:width=2:g={gain}")
        # 3. Dynamics (compand)
        if filter_cfg.get('compressor'):
            af.append("compand=0.3|0.3:1|1:-90/-60|-60/-40|-40/-20|-20/-10|0/-5")
        # 4. Volume
        if filter_cfg.get('volume'):
            af.append(f"volume={filter_cfg['volume']}")
        # 5. Sync/Resampling
        if filter_cfg.get('aresample'):
            af.append("aresample=async=1")
            
        return ",".join(af) if af else ""
