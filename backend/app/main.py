import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.database import engine, Base, SessionLocal
from app.seed import seed_database
from app.api import (
    health_router,
    incidents_router,
    statistics_router,
    vision_router,
    mappls_router,
    tomtom_router,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure upload directory exists
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    
    # Create database tables and seed if database connection is available
    try:
        Base.metadata.create_all(bind=engine)
        
        # Safe backward-compatible SQLite column migration
        if engine.dialect.name == "sqlite":
            try:
                with engine.connect() as conn:
                    from sqlalchemy import text
                    existing_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(vision_analyses)")).fetchall()]
                    new_columns = [
                        ("frame_timestamp_sec", "FLOAT"),
                        ("source_video_name", "VARCHAR(255)"),
                        ("session_id", "VARCHAR(36)"),
                        ("video_hash", "VARCHAR(64)"),
                        ("unique_vehicles_tracked", "INTEGER DEFAULT 0"),
                        ("total_frame_detections", "INTEGER DEFAULT 0"),
                        ("tracking_summary_json", "TEXT DEFAULT '{}'"),
                        ("time_buckets_json", "TEXT DEFAULT '[]'"),
                        ("events_json", "TEXT DEFAULT '[]'"),
                        ("evaluation_summary_json", "TEXT"),
                        ("fps_processed", "FLOAT DEFAULT 0.0"),
                        ("inference_config_json", "TEXT DEFAULT '{}'"),
                    ]
                    for col_name, col_type in new_columns:
                        if col_name not in existing_cols:
                            conn.execute(text(f"ALTER TABLE vision_analyses ADD COLUMN {col_name} {col_type}"))
                    conn.commit()
            except Exception as mig_err:
                print(f"[Transport AI] Notice on column migration: {mig_err}")

        # Auto-seed simulated demo incidents if empty
        db = SessionLocal()
        try:
            count = seed_database(db)
            print(f"[Transport AI] Database initialized with {count} records.")
        finally:
            db.close()
    except Exception as db_init_err:
        print(f"[Transport AI] Database connectivity note on startup: {db_init_err}")

    yield
    # Shutdown logic if any
    pass


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "Production-Oriented Intelligent Transport and Road Safety Platform API. "
        "Provides real-time incident tracking, spatial analytics, corridor performance, "
        "and extensible road-safety computer vision analysis."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom validation error handler for consistent JSON responses
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = []
    for err in exc.errors():
        field = ".".join(str(loc) for loc in err.get("loc", []))
        errors.append({
            "field": field,
            "message": err.get("msg", "Invalid value"),
            "type": err.get("type", "value_error"),
        })
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "Validation Error",
            "status_code": 422,
            "details": errors,
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail if isinstance(exc.detail, str) else "HTTP Exception",
            "status_code": exc.status_code,
        },
    )


# Mount API routers
app.include_router(health_router, prefix=settings.API_V1_PREFIX)
app.include_router(incidents_router, prefix=settings.API_V1_PREFIX)
app.include_router(statistics_router, prefix=settings.API_V1_PREFIX)
app.include_router(vision_router, prefix=settings.API_V1_PREFIX)
app.include_router(mappls_router, prefix=settings.API_V1_PREFIX)
app.include_router(tomtom_router, prefix=settings.API_V1_PREFIX)


@app.get("/")
def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs": "/docs",
        "health": f"{settings.API_V1_PREFIX}/health",
        "data_provenance": "Demonstration datasets are tagged as SIMULATED DEMO DATA.",
    }
