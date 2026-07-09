import os
import sys
from unittest.mock import patch, MagicMock

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

def test_environment_injection():
    # Setup mock sys.argv
    test_argv = ["run_server.py", "--port", "9000", "--config", "backend/tests/scratch_config.conf"]
    
    # Mock uvicorn.run and configparser
    with patch("sys.argv", test_argv), \
         patch("uvicorn.run") as mock_run, \
         patch("os.path.exists", return_value=True):
        
        # Import and run main
        from run_server import main
        main()
        
        assert os.environ.get("ACTIVE_PORT") == "9000"
        assert "CONFIG_FILE_PATH" in os.environ
