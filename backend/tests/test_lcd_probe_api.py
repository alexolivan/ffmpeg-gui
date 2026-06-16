import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_lcd_probe_endpoint():
    response = client.post("/settings/lcd/probe")
    assert response.status_code == 200
    assert "ports" in response.json()
