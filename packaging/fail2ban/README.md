# Fail2ban Integration for ffmpeg-gui

This directory contains ready-to-use Fail2ban rules to protect your `ffmpeg-gui` instance at the OS/Kernel firewall level (iptables / nftables).

## Quick Installation

1. Copy the filter definition:
   ```bash
   sudo cp packaging/fail2ban/filter.d/ffmpeg-gui.conf /etc/fail2ban/filter.d/
   ```

2. Copy the jail configuration:
   ```bash
   sudo cp packaging/fail2ban/jail.d/ffmpeg-gui.local /etc/fail2ban/jail.d/
   ```

3. If your log file lives in a custom path (configured in Settings ➔ Logging), adjust `logpath` in `/etc/fail2ban/jail.d/ffmpeg-gui.local`.

4. Reload Fail2ban:
   ```bash
   sudo fail2ban-client reload
   ```

5. Verify active jail status:
   ```bash
   sudo fail2ban-client status ffmpeg-gui
   ```

6. Test regex matching against your current log:
   ```bash
   sudo fail2ban-regex /var/log/ffmpeg-gui/ffmpeg-gui.log /etc/fail2ban/filter.d/ffmpeg-gui.conf
   ```
