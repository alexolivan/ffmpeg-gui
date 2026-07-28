import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Dict, Any, List, Optional, Tuple

class NotificationManager:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(NotificationManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self.logger = logging.getLogger("NotificationManager")
        self.config = self._default_config()
        self._failed_services = set()
        self._queue = asyncio.Queue()
        self._worker_task = None
        self._running = False

    def _default_config(self) -> Dict[str, Any]:
        return {
            "smtp_host": "localhost",
            "smtp_port": 587,
            "smtp_user": "",
            "smtp_password": "",
            "use_tls": True,
            "use_ssl": False,
            "sender_email": "",
            "recipient_emails": [],
            "enabled": False,
            "notify_service_failures": True,
            "notify_build_results": True,
            "notify_task_failures": True,
            "notify_ssl_alerts": True,
            "notify_storage_alerts": True,
        }

    def _normalize_config(self, config_input: Any) -> Dict[str, Any]:
        """Normalizes raw configuration dictionary or object into internal config format."""
        new_config = self._default_config()

        if isinstance(config_input, dict):
            data = dict(config_input)
        elif hasattr(config_input, "__dict__"):
            data = {k: v for k, v in config_input.__dict__.items() if not k.startswith("_")}
        else:
            data = {}

        # Encryption mode mapping
        if "smtp_encryption" in data:
            enc = str(data["smtp_encryption"]).lower()
            if enc == "ssl":
                new_config["use_ssl"] = True
                new_config["use_tls"] = False
            elif enc == "tls":
                new_config["use_ssl"] = False
                new_config["use_tls"] = True
            elif enc in ("none", "disabled", "false"):
                new_config["use_ssl"] = False
                new_config["use_tls"] = False

        # Handle recipient_email (singular) and recipient_emails (plural)
        rec_data = data.get("recipient_emails") or data.get("recipient_email")
        if rec_data is not None:
            new_config["recipient_emails"] = rec_data

        for key in list(new_config.keys()):
            if key in data and data[key] is not None:
                val = data[key]
                if key == "smtp_port":
                    try: val = int(val)
                    except (ValueError, TypeError): pass
                elif key in ("enabled", "use_tls", "use_ssl", "notify_service_failures", "notify_build_results", "notify_task_failures", "notify_ssl_alerts", "notify_storage_alerts"):
                    if isinstance(val, str):
                        val = val.lower() in ("true", "1", "yes")
                    else:
                        val = bool(val)
                new_config[key] = val

        # Normalize recipient_emails string into clean list
        recipients = new_config.get("recipient_emails")
        if isinstance(recipients, str):
            cleaned = [r.strip() for r in recipients.replace("\n", ",").split(",") if r.strip()]
            new_config["recipient_emails"] = cleaned
        elif isinstance(recipients, list):
            new_config["recipient_emails"] = [str(r).strip() for r in recipients if str(r).strip()]

        return new_config

    def load_config(self, config_input: Any) -> Dict[str, Any]:
        """Loads and normalizes SMTP/Alert notification settings."""
        self.config = self._normalize_config(config_input)
        return self.config

    def is_enabled(self) -> bool:
        return bool(self.config.get("enabled", False))

    def should_notify_service_failure(
        self, proc_id: Any, proc_name: str, is_initial_crash: bool, is_recovered: bool
    ) -> bool:
        """Determines if a notification should be emitted based on failure state coalescing.
        
        Coalescing behavior:
        - Initial crash -> True (add proc to failed set)
        - Repeated watchdog crash while down -> False (silence)
        - Recovery -> True if previously failed (remove proc from failed set), else False
        """
        pid_key = str(proc_id)

        if is_recovered:
            if pid_key in self._failed_services:
                self._failed_services.remove(pid_key)
                return True
            return False

        if is_initial_crash:
            self._failed_services.add(pid_key)
            return True
        else:
            if pid_key in self._failed_services:
                return False
            else:
                self._failed_services.add(pid_key)
                return True

    def _build_email_message(
        self, sender: str, recipients: List[str], subject: str, body: str, html_body: Optional[str] = None
    ) -> MIMEMultipart:
        msg = MIMEMultipart("alternative")
        msg["From"] = sender
        msg["To"] = ", ".join(recipients)
        msg["Subject"] = subject

        msg.attach(MIMEText(body, "plain", "utf-8"))
        if html_body:
            msg.attach(MIMEText(html_body, "html", "utf-8"))

        return msg

    def _dispatch_email(self, config: Dict[str, Any], subject: str, body: str, recipients: Optional[List[str]] = None, html_body: Optional[str] = None) -> Tuple[bool, str]:
        sender = config.get("sender_email") or config.get("smtp_user") or "noreply@ffmpeg-gui.local"
        target_recipients = recipients or config.get("recipient_emails", [])
        if isinstance(target_recipients, str):
            target_recipients = [r.strip() for r in target_recipients.replace("\n", ",").split(",") if r.strip()]

        if not target_recipients:
            return False, "No recipient emails configured."

        host = config.get("smtp_host", "localhost")
        port = int(config.get("smtp_port", 587))
        use_ssl = bool(config.get("use_ssl", False))
        use_tls = bool(config.get("use_tls", True))
        user = config.get("smtp_user", "")
        password = config.get("smtp_password", "")

        msg = self._build_email_message(sender, target_recipients, subject, body, html_body)

        try:
            if use_ssl:
                server = smtplib.SMTP_SSL(host, port, timeout=10)
            else:
                server = smtplib.SMTP(host, port, timeout=10)

            with server:
                if not use_ssl and use_tls:
                    server.starttls()
                if user and password:
                    server.login(user, password)
                server.send_message(msg)

            return True, "Notification sent successfully."
        except Exception as e:
            self.logger.error(f"Failed to dispatch email to {target_recipients}: {e}")
            return False, str(e)

    def send_test_email(self, override_config: Optional[Dict[str, Any]] = None) -> Tuple[bool, str]:
        """Sends a test email immediately using current or overridden configuration."""
        merged_raw = dict(self.config)
        if override_config and isinstance(override_config, dict):
            for k, v in override_config.items():
                if v is not None:
                    if k == "smtp_password" and v == "*****":
                        continue
                    merged_raw[k] = v

        active_config = self._normalize_config(merged_raw)

        subject = "[FFmpeg-GUI] Test Notification"
        body = (
            "Hello,\n\n"
            "This is a test email notification from your FFmpeg-GUI instance.\n"
            "If you received this message, your SMTP settings are configured correctly.\n\n"
            "System Status: Operational\n"
        )

        return self._dispatch_email(active_config, subject, body)

    def enqueue_notification(self, event: Dict[str, Any]) -> bool:
        """Queues a notification event for asynchronous background processing."""
        try:
            self._queue.put_nowait(event)
            return True
        except Exception as e:
            self.logger.error(f"Error queueing notification event: {e}")
            return False

    async def _worker_loop(self):
        """Background async loop consuming queued notification events."""
        self._running = True
        self.logger.info("NotificationManager worker loop started.")
        try:
            while self._running:
                try:
                    event = await self._queue.get()
                except asyncio.CancelledError:
                    break

                try:
                    subject = event.get("subject", "[FFmpeg-GUI Alert]")
                    body = event.get("body", "")
                    html_body = event.get("html_body")
                    recipients = event.get("recipients")

                    success, msg = self._dispatch_email(
                        self.config, subject, body, recipients=recipients, html_body=html_body
                    )
                    if success:
                        self.logger.info(f"Notification '{subject}' dispatched successfully.")
                    else:
                        self.logger.warning(f"Notification '{subject}' dispatch failed: {msg}")
                except Exception as ex:
                    self.logger.error(f"Unhandled error processing notification event: {ex}")
                finally:
                    self._queue.task_done()
        except asyncio.CancelledError:
            pass
        finally:
            self._running = False
            self.logger.info("NotificationManager worker loop stopped.")

    def start_worker(self, loop: Optional[asyncio.AbstractEventLoop] = None) -> asyncio.Task:
        """Starts the background worker task if not already running."""
        if self._worker_task is None or self._worker_task.done():
            current_loop = loop or asyncio.get_event_loop()
            self._worker_task = current_loop.create_task(self._worker_loop())
        return self._worker_task

    def stop_worker(self):
        """Stops the background worker task."""
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
