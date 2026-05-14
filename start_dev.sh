#!/bin/bash

echo "Starting FFMPEG-GUI Development Servers..."

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
