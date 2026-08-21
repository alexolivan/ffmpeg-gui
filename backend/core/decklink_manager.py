import os
import re
import json
import shutil
import asyncio
import logging
import subprocess
from typing import Dict, List, Any, Optional
from sqlalchemy.orm import Session
try:
    from database.models import SoftwareBuild
except ImportError:
    from backend.database.models import SoftwareBuild

logger = logging.getLogger("DecklinkManager")


class DecklinkManager:
    """Singleton para orquestación, telemetría y configuración de hardware Blackmagic DeckLink."""

    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(DecklinkManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._lock = asyncio.Lock()
        self._cache_devices: List[Dict[str, Any]] = []
        self._last_scan_time = 0.0

    def get_desktopvideo_version(self) -> Optional[str]:
        """Consulta la versión del paquete desktopvideo instalado en el sistema operativo."""
        try:
            res = subprocess.run(
                ["dpkg-query", "-W", "-f=${Version}", "desktopvideo"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except Exception:
            pass

        # Fallback check for rpm
        try:
            res = subprocess.run(
                ["rpm", "-q", "--qf", "%{VERSION}-%{RELEASE}", "desktopvideo"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except Exception:
            pass

        return None

    def get_firmware_status(self) -> Dict[str, Any]:
        """Ejecuta BlackmagicFirmwareUpdater status para comprobar el estado de firmware de las tarjetas."""
        updater_bin = shutil.which("BlackmagicFirmwareUpdater") or "/usr/bin/BlackmagicFirmwareUpdater"
        if not os.path.exists(updater_bin):
            return {
                "available": False,
                "needs_update": False,
                "raw_output": "BlackmagicFirmwareUpdater no encontrado en el sistema.",
                "devices": [],
            }

        try:
            res = subprocess.run(
                [updater_bin, "status"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            raw = res.stdout + res.stderr
            needs_update = "update required" in raw.lower() or "requires update" in raw.lower()
            
            devices_status = []
            for line in raw.splitlines():
                line = line.strip()
                if line and ("/dev/blackmagic" in line or "OK" in line or "update" in line.lower() or "intensity" in line.lower() or "decklink" in line.lower()):
                    devices_status.append(line)

            return {
                "available": True,
                "needs_update": needs_update,
                "raw_output": raw.strip(),
                "devices": devices_status,
            }
        except Exception as e:
            return {
                "available": True,
                "needs_update": False,
                "raw_output": f"Error al consultar BlackmagicFirmwareUpdater: {e}",
                "devices": [],
            }

    def _resolve_build_binary_path(self, build: Optional[SoftwareBuild]) -> Optional[str]:
        """Resuelve de forma segura el binario ejecutable asociado a un SoftwareBuild."""
        if not build:
            return None
        if build.binary_path and os.path.exists(build.binary_path) and os.access(build.binary_path, os.X_OK):
            return build.binary_path

        # Check install_path
        if build.install_path:
            candidates = [
                os.path.join(build.install_path, "decklink-ctl"),
                os.path.join(build.install_path, "install", "decklink-ctl"),
                os.path.join(build.install_path, "bin", "decklink-ctl"),
            ]
            for cand in candidates:
                if os.path.exists(cand) and os.access(cand, os.X_OK):
                    return cand

        # Check storage or default ffmpeg_builds root
        base_dir = build.storage.path if (hasattr(build, "storage") and build.storage) else os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ffmpeg_builds"))
        candidates = [
            os.path.join(base_dir, str(build.id), "install", "decklink-ctl"),
            os.path.join(base_dir, str(build.id), "decklink-ctl"),
        ]
        for cand in candidates:
            if os.path.exists(cand) and os.access(cand, os.X_OK):
                return cand

        return None

    def get_active_helper_path(self, db: Optional[Session] = None) -> Optional[str]:
        """Localiza el binario 'decklink-ctl' activo configurado en la Forja o en rutas del sistema."""
        if db is None:
            try:
                try:
                    from database.db import SessionLocal
                except ImportError:
                    from backend.database.db import SessionLocal
                with SessionLocal() as session:
                    return self.get_active_helper_path(session)
            except Exception as e:
                logger.warning(f"Error opening DB session in get_active_helper_path: {e}")

        if db is not None:
            try:
                # 1. Check default build for decklink_tools
                default_build = (
                    db.query(SoftwareBuild)
                    .filter(
                        (SoftwareBuild.software_type == "decklink_tools") | (SoftwareBuild.name.ilike("%decklink%")),
                        SoftwareBuild.is_default == True,
                    )
                    .order_by(SoftwareBuild.id.desc())
                    .first()
                )
                cand = self._resolve_build_binary_path(default_build)
                if cand:
                    return cand

                # 2. Check latest valid ready build for decklink_tools
                latest_build = (
                    db.query(SoftwareBuild)
                    .filter(
                        (SoftwareBuild.software_type == "decklink_tools") | (SoftwareBuild.name.ilike("%decklink%")),
                        SoftwareBuild.status == "ready",
                    )
                    .order_by(SoftwareBuild.id.desc())
                    .first()
                )
                cand = self._resolve_build_binary_path(latest_build)
                if cand:
                    return cand
            except Exception as e:
                logger.warning(f"Error querying SoftwareBuild for decklink_tools: {e}")

        # 3. Forge builds filesystem search fallback
        try:
            import glob
            build_candidates = sorted(
                glob.glob(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ffmpeg_builds", "*", "install", "decklink-ctl"))),
                reverse=True,
            )
            for path in build_candidates:
                if os.path.exists(path) and os.access(path, os.X_OK):
                    return path
        except Exception:
            pass

        # 4. System / Local paths
        candidates = [
            "/usr/local/bin/decklink-ctl",
            "/usr/bin/decklink-ctl",
            os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "bin", "decklink-ctl")),
        ]
        for path in candidates:
            if os.path.exists(path) and os.access(path, os.X_OK):
                return path

        return None

    def get_helper_version(self, helper_path: str) -> Optional[str]:
        """Obtiene la versión reportada por el binario decklink-ctl."""
        try:
            res = subprocess.run(
                [helper_path, "--version"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if res.returncode == 0 and res.stdout.strip():
                lines = [l.strip() for l in res.stdout.strip().splitlines() if l.strip()]
                first_line = lines[0] if lines else "decklink-ctl"
                sdk_line = next((l for l in lines if "DeckLink API Version:" in l), "")
                if sdk_line:
                    sdk_ver = sdk_line.replace("DeckLink API Version:", "").strip()
                    return f"{first_line.split('(')[0].strip()} (SDK {sdk_ver})"
                return first_line
        except Exception:
            pass
        return None

    async def get_devices(self, db: Optional[Session] = None) -> List[Dict[str, Any]]:
        """Invoca 'decklink-ctl list' para obtener la lista estructurada de tarjetas y subdispositivos."""
        helper_path = self.get_active_helper_path(db)
        if not helper_path:
            return []

        try:
            proc = await asyncio.create_subprocess_exec(
                helper_path,
                "list",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
            if proc.returncode == 0 and stdout:
                data = json.loads(stdout.decode("utf-8"))
                if data.get("success"):
                    self._cache_devices = data.get("devices", [])
                    return self._cache_devices
                else:
                    logger.warning(f"decklink-ctl list returned error: {data.get('error')}")
        except Exception as e:
            logger.warning(f"Failed to execute decklink-ctl list: {e}")

        return self._cache_devices

    def list_devices_sync(self, db: Optional[Session] = None) -> List[Dict[str, Any]]:
        """Invoca 'decklink-ctl list' o sondea PCI de forma síncrona para obtener las tarjetas DeckLink."""
        helper_path = self.get_active_helper_path(db)
        if helper_path:
            try:
                res = subprocess.run(
                    [helper_path, "list"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if res.returncode == 0 and res.stdout:
                    data = json.loads(res.stdout)
                    if data.get("success") and data.get("devices"):
                        self._cache_devices = data.get("devices", [])
                        return self._cache_devices
                    elif not data.get("success"):
                        logger.warning(f"Sync decklink-ctl list returned error: {data.get('error')}")
            except Exception as e:
                logger.debug(f"Error in sync decklink-ctl list: {e}")

        return self._probe_pci_cards_sync()

    def _probe_pci_cards_sync(self) -> List[Dict[str, Any]]:
        """Sondeo por hardware PCI/udev/firmware updater de tarjetas Blackmagic Design cuando el helper no está presente."""
        cards = []
        
        # Method 1: lspci (vendor 11b8 or keyword)
        try:
            res = subprocess.run(
                ["lspci"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if res.returncode == 0 and res.stdout:
                for line in res.stdout.splitlines():
                    if "Blackmagic" in line or "DeckLink" in line:
                        # e.g. "04:00.0 Multimedia video controller: Blackmagic Design Intensity Pro"
                        model = line.split(":")[-1].replace("Blackmagic Design", "").strip()
                        if model:
                            cards.append({
                                "model_name": model,
                                "display_name": model,
                                "index": len(cards),
                            })
                if cards:
                    return cards
        except Exception:
            pass

        # Method 2: BlackmagicFirmwareUpdater status (e.g. "0:\t/dev/blackmagic/dv0 [Intensity Pro]\t0x25\tOK")
        try:
            fw_status = self.get_firmware_status()
            raw = fw_status.get("raw_output", "")
            for line in raw.splitlines():
                matches = re.findall(r'\[(.*?)\]', line)
                if matches:
                    card_name = matches[0].strip()
                    if card_name and card_name.lower() not in ("ok", "failed", "error"):
                        cards.append({
                            "model_name": card_name,
                            "display_name": card_name,
                            "index": len(cards),
                        })
            if cards:
                return cards
        except Exception:
            pass

        # Method 3: Sysfs PCI vendor check (0x11b8)
        try:
            import glob
            for dev_path in glob.glob("/sys/bus/pci/devices/*"):
                vendor_file = os.path.join(dev_path, "vendor")
                if os.path.exists(vendor_file):
                    with open(vendor_file, "r") as f:
                        if f.read().strip().lower() == "0x11b8":
                            cards.append({
                                "model_name": "Blackmagic PCIe Device",
                                "display_name": "Blackmagic PCIe Device",
                                "index": len(cards),
                            })
            if cards:
                return cards
        except Exception:
            pass

        return cards

    async def get_device_telemetry(self, device_id: str, db: Optional[Session] = None) -> Dict[str, Any]:
        """Invoca 'decklink-ctl status --device=...' para obtener la telemetría en tiempo real."""
        helper_path = self.get_active_helper_path(db)
        if not helper_path:
            return {
                "success": False,
                "error": "decklink-ctl helper no disponible. Compile la receta 'DeckLink Tools' en la Forja.",
            }

        try:
            proc = await asyncio.create_subprocess_exec(
                helper_path,
                "status",
                f"--device={device_id}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=4.0)
            if proc.returncode == 0 and stdout:
                return json.loads(stdout.decode("utf-8"))
            return {
                "success": False,
                "error": f"decklink-ctl status falló con código {proc.returncode}",
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def configure_device(
        self,
        device_id: str,
        payload: Dict[str, Any],
        db: Optional[Session] = None,
        process_manager: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Aplica la configuración de hardware asegurando mutua exclusión con servicios FFmpeg activos."""
        helper_path = self.get_active_helper_path(db)
        if not helper_path:
            return {
                "success": False,
                "error": "decklink-ctl helper no disponible. Compile la receta 'DeckLink Tools' en la Forja.",
            }

        # Safety Check: Inspect active services in ProcessManager
        if process_manager is not None:
            try:
                active_procs = process_manager.get_active_processes()
                for p in active_procs:
                    cfg = getattr(p, "config", {}) or {}
                    input_url = str(cfg.get("input_url", "")).lower()
                    output_url = str(cfg.get("output_url", "")).lower()
                    dev_str = str(device_id).lower()
                    
                    if "decklink" in input_url or "decklink" in output_url:
                        if dev_str in input_url or dev_str in output_url:
                            return {
                                "success": False,
                                "conflict": True,
                                "error": f"El dispositivo DeckLink '{device_id}' está siendo utilizado por el servicio activo '{getattr(p, 'name', p.id)}'. Detenga el servicio antes de reconfigurar.",
                            }
            except Exception as e:
                logger.warning(f"Error checking active process conflicts: {e}")

        # Build CLI arguments
        cmd_args = [helper_path, "configure", f"--device={device_id}"]
        
        if "duplex" in payload and payload["duplex"]:
            cmd_args.append(f"--duplex={payload['duplex']}")
        if "default_mode" in payload and payload["default_mode"]:
            cmd_args.append(f"--default-mode={payload['default_mode']}")
        if "connection" in payload and payload["connection"]:
            cmd_args.append(f"--connection={payload['connection']}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5.0)
            if proc.returncode == 0 and stdout:
                return json.loads(stdout.decode("utf-8"))
            
            err_msg = stderr.decode("utf-8").strip() if stderr else f"Error code {proc.returncode}"
            return {"success": False, "error": err_msg}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def update_firmware(self, device_index: int) -> Dict[str, Any]:
        """Ejecuta BlackmagicFirmwareUpdater update <index> para flashear el firmware del dispositivo."""
        updater_bin = shutil.which("BlackmagicFirmwareUpdater") or "/usr/bin/BlackmagicFirmwareUpdater"
        if not os.path.exists(updater_bin):
            return {
                "success": False,
                "error": "BlackmagicFirmwareUpdater no encontrado en el sistema.",
            }

        try:
            proc = await asyncio.create_subprocess_exec(
                updater_bin,
                "update",
                str(device_index),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)
            raw = (stdout.decode("utf-8") + stderr.decode("utf-8")).strip()
            
            return {
                "success": proc.returncode == 0,
                "output": raw,
                "return_code": proc.returncode,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def get_system_status(
        self,
        db: Optional[Session] = None,
        process_manager: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Compila el estado global de compatibilidad, drivers, firmware y tarjetas del sistema."""
        driver_ver = self.get_desktopvideo_version()
        firmware_info = self.get_firmware_status()
        helper_path = self.get_active_helper_path(db)
        helper_ver = self.get_helper_version(helper_path) if helper_path else None
        devices = await self.get_devices(db)

        # Inspect active processes using each DeckLink device
        if process_manager is not None and devices:
            try:
                active_procs = process_manager.get_active_processes()
                for dev in devices:
                    dev_idx_str = str(dev.get("index", ""))
                    dev_pers_str = str(dev.get("persistent_id", ""))
                    dev_name = str(dev.get("display_name", "")).lower()
                    
                    matched_procs = []
                    for p in active_procs:
                        cfg = getattr(p, "config", {}) or {}
                        input_cfg = cfg.get("input_config") or {}
                        output_cfg = cfg.get("output_config") or {}
                        
                        input_url = str(input_cfg.get("url", "") or cfg.get("input_url", "")).lower()
                        output_url = str(output_cfg.get("url", "") or cfg.get("output_url", "")).lower()
                        in_fmt = str(input_cfg.get("format", "")).lower()
                        out_fmt = str(output_cfg.get("format", "")).lower()
                        
                        is_input = ("decklink" in in_fmt or "decklink" in input_url) and (
                            dev_name in input_url or dev_idx_str in input_url or (dev_pers_str and dev_pers_str in input_url)
                        )
                        is_output = ("decklink" in out_fmt or "decklink" in output_url) and (
                            dev_name in output_url or dev_idx_str in output_url or (dev_pers_str and dev_pers_str in output_url)
                        )
                        
                        if is_input or is_output:
                            matched_procs.append({
                                "process_id": getattr(p, "id", None),
                                "name": getattr(p, "name", str(getattr(p, "id", ""))),
                                "status": getattr(p, "status", "running"),
                                "direction": "input" if is_input else "output",
                            })
                    dev["active_processes"] = matched_procs
            except Exception as e:
                logger.debug(f"Error mapping active processes to DeckLink devices: {e}")

        # Compatibility Assessment
        is_ready = bool(driver_ver and helper_path and len(devices) > 0 and not firmware_info.get("needs_update"))
        status_code = "READY" if is_ready else "WARNING" if (driver_ver and helper_path) else "SETUP_REQUIRED"

        return {
            "driver_version": driver_ver,
            "driver_installed": bool(driver_ver),
            "helper_path": helper_path,
            "helper_version": helper_ver,
            "helper_available": bool(helper_path),
            "firmware": firmware_info,
            "devices": devices,
            "device_count": len(devices),
            "system_status": status_code,
        }
