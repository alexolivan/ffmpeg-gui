from database.db import SessionLocal, init_db
from database.models import MediaProcess

def seed():
    init_db()
    db = SessionLocal()
    
    # Check if already seeded
    if db.query(MediaProcess).count() == 0:
        p1 = MediaProcess(
            name="SRT Main Contribution",
            type="service",
            input_config={"type": "srt", "host": "0.0.0.0", "port": 9000, "mode": "listener"},
            output_config={"type": "udp", "host": "127.0.0.1", "port": 1234},
            codec_config={"vcodec": "libx264", "acodec": "aac"},
            status="stopped"
        )
        p2 = MediaProcess(
            name="NDI to RTMP (YouTube)",
            type="service",
            input_config={"type": "ndi", "name": "STUDIO-1"},
            output_config={"type": "rtmp", "url": "rtmp://live.youtube.com/app/key"},
            codec_config={"vcodec": "libx264", "acodec": "aac"},
            status="running",
            cpu_usage=15,
            ram_usage=256
        )
        db.add(p1)
        db.add(p2)
        db.commit()
        print("Database seeded successfully")
    else:
        print("Database already has data")

if __name__ == "__main__":
    seed()
