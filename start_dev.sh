#!/bin/bash

echo "Starting FFMPEG-GUI Development Servers..."

echo "--> Cleaning up any existing rogue processes on ports 8000 and 5173..."
if command -v fuser >/dev/null 2>&1; then
    fuser -k 8000/tcp 2>/dev/null
    fuser -k 5173/tcp 2>/dev/null
else
    kill -9 $(lsof -t -i:8000) 2>/dev/null
    kill -9 $(lsof -t -i:5173) 2>/dev/null
fi
sleep 1

# 1. Start Backend
echo "--> Starting Backend (FastAPI)..."
source venv/bin/activate
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# 2. Start Frontend
echo "--> Starting Frontend (Vite)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo "Servers are running! Press Ctrl+C to stop both."

# Cleanup function to kill both servers on exit
cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $BACKEND_PID
    kill $FRONTEND_PID
    exit
}

# Trap Ctrl+C (SIGINT) and SIGTERM
trap cleanup SIGINT SIGTERM

# Keep script running while servers are running
wait $BACKEND_PID $FRONTEND_PID
