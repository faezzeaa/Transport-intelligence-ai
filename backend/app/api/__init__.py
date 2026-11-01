from app.api.health import router as health_router
from app.api.incidents import router as incidents_router
from app.api.statistics import router as statistics_router
from app.api.vision import router as vision_router
from app.api.mappls import router as mappls_router
from app.api.tomtom import router as tomtom_router

__all__ = [
    "health_router",
    "incidents_router",
    "statistics_router",
    "vision_router",
    "mappls_router",
    "tomtom_router",
]
