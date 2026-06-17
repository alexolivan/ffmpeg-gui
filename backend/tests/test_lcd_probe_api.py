import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_lcd_probe_endpoint():
    response = client.post("/settings/lcd/probe")
    assert response.status_code == 200
    assert "ports" in response.json()

from unittest.mock import MagicMock, patch

def test_lcd_probe_active_port_no_conflict():
    from main import app
    import main
    
    # Mock global lcd_manager as running on /dev/ttyACM0
    mock_lcd = MagicMock()
    mock_lcd._running = True
    mock_lcd.port = "/dev/ttyACM0"
    
    with patch("main.lcd_manager", mock_lcd), \
         patch("serial.tools.list_ports.comports") as mock_comports:
         
        # Mock comports list
        mock_port = MagicMock()
        mock_port.device = "/dev/ttyACM0"
        mock_port.description = "Crystalfontz USB LCD"
        mock_comports.return_value = [mock_port]
        
        response = client.post("/settings/lcd/probe")
        assert response.status_code == 200
        data = response.json()
        assert len(data["ports"]) == 1
        assert data["ports"][0]["port"] == "/dev/ttyACM0"
        assert "(Active)" in data["ports"][0]["description"]
