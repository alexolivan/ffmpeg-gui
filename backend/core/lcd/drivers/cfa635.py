import struct
import serial
from ..interface import LCDDisplayInterface

class Cfa635Driver(LCDDisplayInterface):
    def __init__(self, port: str, baud_rate: int = 115200, cols: int = 20, rows: int = 4):
        self.port = port
        self.baud_rate = baud_rate
        self.cols = cols
        self.rows = rows
        self.ser = None

    def connect(self) -> None:
        self.ser = serial.Serial(self.port, self.baud_rate, timeout=0.1)

    def disconnect(self) -> None:
        if self.ser and self.ser.is_open:
            self.ser.close()

    def _calculate_crc(self, data: bytes) -> int:
        crc = 0xFFFF
        for byte in data:
            crc ^= byte
            for _ in range(8):
                crc = (crc >> 1) ^ 0x8408 if crc & 0x0001 else crc >> 1
        return ~crc & 0xFFFF

    def _send_packet(self, command: int, data: bytes) -> bytes:
        packet = struct.pack(f"BB{len(data)}s", command, len(data), data)
        full_packet = packet + struct.pack("<H", self._calculate_crc(packet))
        if self.ser and self.ser.is_open:
            self.ser.write(full_packet)
            return self.ser.read(100)
        return b""

    def write_line(self, row: int, text: str) -> None:
        formatted_text = text[:self.cols].ljust(self.cols)
        payload = struct.pack(f"BB{self.cols}s", 0, row, formatted_text.encode('ascii', errors='ignore'))
        self._send_packet(31, payload)

    def clear(self) -> None:
        self._send_packet(6, b"")

    def set_backlight(self, brightness: int) -> None:
        """
        Set backlight brightness (0-100).
        Command 14 (0x0E), data length 1, value 0-100.
        """
        brightness = max(0, min(100, brightness))
        self._send_packet(14, struct.pack("B", brightness))

    @classmethod
    def probe(cls, port: str) -> bool:
        try:
            ser = serial.Serial(port, 115200, timeout=0.2)
            # Send ping command (0)
            packet = struct.pack("BB", 0, 0)
            # CRC for b'\x00\x00' is 0x0F47 (LSB: 0x47, MSB: 0x0F)
            full_packet = packet + b'\x47\x0f'
            ser.write(full_packet)
            resp = ser.read(16)
            ser.close()
            return len(resp) >= 4 and resp[0] == 0x40  # Response packet to command 0 has command 0x40 (ping response)
        except Exception:
            return False
