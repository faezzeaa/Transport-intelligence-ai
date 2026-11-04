from typing import Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.services.mappls import get_mappls_service

router = APIRouter(prefix="/mappls", tags=["Mappls Geospatial Integration"])


class RouteRequest(BaseModel):
    start_lng: float = Field(..., description="Origin longitude")
    start_lat: float = Field(..., description="Origin latitude")
    end_lng: float = Field(..., description="Destination longitude")
    end_lat: float = Field(..., description="Destination latitude")
    profile: str = Field("driving", description="Routing profile: driving, walking, biking")


@router.get("/status")
def get_mappls_status():
    """
    Returns real-time verification of Mappls credentials and product entitlements.
    Confirms whether credentials are valid, invalid (HTTP 401), or missing,
    without leaking secrets in the response or logs.
    """
    service = get_mappls_service()
    return service.get_status()


@router.get("/geocode")
@router.get("/search")
def geocode_location(query: str = Query(..., min_length=2, description="Place or address query")):
    """
    Geocodes an address or place using Mappls Geocode & Place Search APIs.
    Seamlessly routes through Mappls OAuth2 or Mappls REST API Key.
    """
    service = get_mappls_service()
    result = service.geocode(query)
    return result


@router.post("/route")
def calculate_route(payload: RouteRequest):
    """
    Calculates route between coordinates via Mappls Routing API.
    Does not fabricate false routes if credentials are rejected.
    """
    service = get_mappls_service()
    result = service.calculate_route(
        start_lng=payload.start_lng,
        start_lat=payload.start_lat,
        end_lng=payload.end_lng,
        end_lat=payload.end_lat,
        profile=payload.profile,
    )
    return result
