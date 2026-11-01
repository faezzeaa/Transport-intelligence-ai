from pathlib import Path
from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

backend_dir = Path(__file__).resolve().parent.parent
repo_root = backend_dir.parent

# Base files first, local overrides last (highest precedence in pydantic-settings)
_env_files = [
    str(backend_dir / ".env"),
    str(repo_root / ".env"),
    str(backend_dir / ".env.local"),
    str(repo_root / ".env.local"),
]


class Settings(BaseSettings):
    PROJECT_NAME: str = "Intelligent Transport AI"
    VERSION: str = "1.0.0"
    API_V1_PREFIX: str = "/api"
    
    # Server
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DEBUG: bool = True
    
    # Persistence
    DATABASE_URL: str = "sqlite:///./transport.db"
    
    # Security & CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    
    # Vision & Upload limits
    MAX_UPLOAD_SIZE_BYTES: int = 20 * 1024 * 1024  # 20 MB
    MAX_VIDEO_DURATION_SECONDS: float = 60.0       # Max video duration in seconds
    UPLOAD_DIR: str = "./uploads"
    VISION_ADAPTER: str = "simulator"              # "simulator" or "real"
    VISION_MODEL_PATH: str = "backend/weights/yolov8n.onnx"
    SAMPLE_FPS: float = 1.0                        # 1 frame per second sampling
    MAX_SAMPLED_FRAMES: int = 30                   # Cap sampled frames to keep latency predictable
    
    # Demo configuration
    DEMO_DATA_TAG: str = "SIMULATED DEMO DATA"

    # Mappls (MapmyIndia) Integration
    MAPPLS_CLIENT_ID: str = ""
    MAPPLS_CLIENT_SECRET: str = ""
    MAPPLS_REST_KEY: str = ""

    # TomTom Geospatial & Real-Time Traffic Integration
    TOMTOM_API_KEY: str = ""

    model_config = SettingsConfigDict(
        env_file=tuple(_env_files),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )


@lru_cache()
def get_settings() -> Settings:
    return Settings()
