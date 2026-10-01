import logging
import os
import socket
from typing import Any, Dict, List, Optional, Tuple
import psutil

logger = logging.getLogger("ffmpeg_gui.network_inspector")


def _get_default_gateway_interface() -> Optional[str]:
    """Inspect Linux /proc/net/route to find the network interface with default gateway (0.0.0.0 destination)."""
    try:
        route_path = "/proc/net/route"
        if os.path.exists(route_path):
            with open(route_path, "r") as f:
                lines = f.readlines()
            for line in lines[1:]:
                fields = line.strip().split()
                if len(fields) >= 4:
                    iface = fields[0]
                    dest = fields[1]
                    flags = int(fields[3], 16)
                    # Destination 00000000 and RTF_UP (0x1) + RTF_GATEWAY (0x2)
                    if dest == "00000000" and (flags & 0x2):
                        return iface
    except Exception as e:
        logger.debug("Could not inspect /proc/net/route: %s", e)
    return None


def get_network_interfaces() -> List[Dict[str, Any]]:
    """
    Enumerate all network interfaces on the host with status, addresses, and capabilities.
    """
    interfaces = []
    try:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        default_gw_iface = _get_default_gateway_interface()

        af_packet = getattr(psutil, 'AF_LINK', None)
        if af_packet is None and hasattr(socket, 'AF_PACKET'):
            af_packet = socket.AF_PACKET

        for iface_name, iface_addrs in addrs.items():
            iface_stat = stats.get(iface_name)
            is_up = iface_stat.isup if iface_stat else False
            speed = iface_stat.speed if iface_stat else 0

            ipv4_list = []
            ipv6_list = []
            mac = None
            is_loopback = (iface_name == "lo")

            for addr in iface_addrs:
                if addr.family == socket.AF_INET:
                    ipv4_list.append({
                        "address": addr.address,
                        "netmask": addr.netmask,
                        "broadcast": addr.broadcast
                    })
                    if addr.address.startswith("127."):
                        is_loopback = True
                elif addr.family == socket.AF_INET6:
                    # Strip %scope_id if present
                    clean_ipv6 = addr.address.split("%")[0]
                    ipv6_list.append({
                        "address": clean_ipv6,
                        "netmask": addr.netmask
                    })
                elif af_packet is not None and addr.family == af_packet:
                    mac = addr.address

            interfaces.append({
                "name": iface_name,
                "is_up": is_up,
                "speed": speed,
                "mac": mac,
                "ipv4_addresses": ipv4_list,
                "ipv6_addresses": ipv6_list,
                "is_loopback": is_loopback,
                "is_default_gateway": (iface_name == default_gw_iface)
            })

        # Sort: default gateway first, then up interfaces, then loopback, then down
        interfaces.sort(
            key=lambda x: (
                not x["is_default_gateway"],
                x["is_loopback"],
                not x["is_up"],
                x["name"]
            )
        )
    except Exception as e:
        logger.error("Error inspecting network interfaces: %s", e)

    return interfaces


def resolve_bind_address(configured_host: str, fallback_host: str = "0.0.0.0") -> Tuple[str, bool, Optional[str]]:
    """
    Validate and resolve a configured bind host (IP or interface name) against active host interfaces.
    Returns: (effective_host, fell_back: bool, reason: Optional[str])
    """
    clean_host = (configured_host or "").strip()

    # Universal wildcard and localhost bindings are always safe and valid
    if clean_host in ("", "0.0.0.0", "::", "127.0.0.1", "localhost"):
        return (clean_host or fallback_host, False, None)

    try:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
    except Exception as e:
        logger.warning("Could not query network interfaces via psutil: %s. Preserving configured host.", e)
        return (clean_host, False, None)

    # Case 1: Configured host is specified by Interface Name (e.g. 'eth0', 'eno1', 'wlan0')
    if clean_host in addrs:
        iface_stat = stats.get(clean_host)
        if iface_stat and not iface_stat.isup:
            return (
                fallback_host,
                True,
                f"Configured interface '{clean_host}' is DOWN. Falling back to '{fallback_host}' to prevent administrative lockout."
            )

        ipv4_addrs = [a.address for a in addrs[clean_host] if a.family == socket.AF_INET]
        if ipv4_addrs:
            return (ipv4_addrs[0], False, None)
        else:
            return (
                fallback_host,
                True,
                f"Configured interface '{clean_host}' has no active IPv4 address assigned. Falling back to '{fallback_host}' to prevent administrative lockout."
            )

    # Case 2: Configured host is an IP address (e.g. '192.168.1.50')
    found_on_iface = None
    iface_is_up = False

    for iface_name, iface_addrs in addrs.items():
        for addr in iface_addrs:
            if addr.family == socket.AF_INET and addr.address == clean_host:
                found_on_iface = iface_name
                stat = stats.get(iface_name)
                iface_is_up = stat.isup if stat else True
                break
        if found_on_iface:
            break

    if found_on_iface:
        if not iface_is_up:
            return (
                fallback_host,
                True,
                f"Interface '{found_on_iface}' with IP '{clean_host}' is DOWN. Falling back to '{fallback_host}' to prevent administrative lockout."
            )
        return (clean_host, False, None)

    # If the IP is not bound to any interface on this host (DHCP renewal, network card change, config import)
    return (
        fallback_host,
        True,
        f"Configured IP '{clean_host}' is not assigned to any active interface (DHCP renewal or hardware change). Falling back to '{fallback_host}' to prevent admin lockout."
    )
