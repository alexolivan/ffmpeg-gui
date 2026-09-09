"""
Encapsulated Watchdog Circuit Breaker.
Evaluates whether an unexpected subprocess termination was caused by a fatal,
unrecoverable error (such as unsupported protocol, missing codec, or invalid CLI syntax)
rather than a transient network or hardware glitch.
"""

import re
from typing import Tuple, List, Optional

# Non-recoverable fatal error patterns in FFmpeg stderr
FATAL_PATTERNS = [
    (re.compile(r"Protocol\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?\s+not\s+found", re.IGNORECASE), "Protocol not supported by binary"),
    (re.compile(r"['\"]?([a-zA-Z0-9_\-]+)['\"]?:\s+Protocol\s+not\s+found", re.IGNORECASE), "Protocol not supported by binary"),
    (re.compile(r"Unknown\s+(?:output|input)?\s*format[:\s]+['\"]?([a-zA-Z0-9_\-]+)['\"]?", re.IGNORECASE), "Format not supported by binary"),
    (re.compile(r"Unknown\s+encoder\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?", re.IGNORECASE), "Encoder not supported by binary"),
    (re.compile(r"Unknown\s+decoder\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?", re.IGNORECASE), "Decoder not supported by binary"),
    (re.compile(r"Unrecognized\s+option\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?", re.IGNORECASE), "Unrecognized CLI option"),
    (re.compile(r"No\s+such\s+filter[:\s]+['\"]?([a-zA-Z0-9_\-]+)['\"]?", re.IGNORECASE), "Filter not supported by binary"),
    (re.compile(r"Option\s+['\"]?([a-zA-Z0-9_\-]+)['\"]?\s+not\s+found", re.IGNORECASE), "Option not supported by binary"),
    (re.compile(r"Cannot\s+find\s+a\s+valid\s+device", re.IGNORECASE), "Hardware device not found"),
]

def analyze_fatal_error(log_lines: List[str], execution_duration: float = 0.0) -> Tuple[bool, Optional[str]]:
    """
    Analyzes log output from an unexpected process exit.
    Returns (is_fatal, reason_string).
    
    A failure is classified as fatal only if:
    1. The execution duration was brief (<= 3.0 seconds), indicating a startup failure
       rather than a mid-stream transient disconnect.
    2. The log contains explicit error signatures of unsupported protocols, formats, or options.
    """
    if execution_duration > 3.0:
        return False, None

    if not log_lines:
        return False, None

    # Inspect up to the last 60 lines
    search_lines = log_lines[-60:]
    for line in reversed(search_lines):
        for pattern, desc in FATAL_PATTERNS:
            match = pattern.search(line)
            if match:
                matched_item = match.group(1) if match.groups() else ""
                reason = f"{desc}: {matched_item}" if matched_item else desc
                return True, reason

    return False, None
