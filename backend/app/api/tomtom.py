from typing import Optional
from fastapi import APIRouter, Query, Response, status, HTTPException
from app.services.tomtom import get_tomtom_service

router = APIRouter(prefix="/tomtom", tags=["TomTom Live Traffic Intelligence"])


@router.get("/status")
def get_tomtom_status():
    """
    Returns TomTom service operational diagnostic status, capabilities,
    and masked API key without leaking the actual secret.
    """
    service = get_tomtom_service()
    return service.get_status()


@router.get("/flow")
def get_traffic_flow(
    lat: float = Query(..., description="Latitude coordinate"),
    lng: float = Query(..., description="Longitude coordinate"),
    unit: str = Query("KMPH", description="Speed unit ('KMPH' or 'MPH')"),
):
    """
    Retrieves real-time traffic flow speed, congestion level, and corridor travel time
    for a specific point using TomTom Flow Segment API.
    """
    service = get_tomtom_service()
    res = service.get_flow_segment(latitude=lat, longitude=lng, unit=unit)
    if not res.get("success"):
        raise HTTPException(
            status_code=res.get("http_status_code") or status.HTTP_502_BAD_GATEWAY,
            detail=res.get("error") or "Failed to retrieve traffic flow data.",
        )
    return res


@router.get("/incidents")
def get_traffic_incidents(
    min_lon: float = Query(80.15, description="Minimum longitude (West)"),
    min_lat: float = Query(12.95, description="Minimum latitude (South)"),
    max_lon: float = Query(80.35, description="Maximum longitude (East)"),
    max_lat: float = Query(13.15, description="Maximum latitude (North)"),
):
    """
    Retrieves real-time traffic incidents (accidents, congestion, roadworks, closures)
    within the specified geographic bounding box. Clamps automatically if area > 8,500 km2.
    """
    service = get_tomtom_service()
    res = service.get_incidents(min_lon=min_lon, min_lat=min_lat, max_lon=max_lon, max_lat=max_lat)
    if not res.get("success"):
        raise HTTPException(
            status_code=res.get("http_status_code") or status.HTTP_502_BAD_GATEWAY,
            detail=res.get("error") or "Failed to retrieve traffic incidents.",
        )
    return res


@router.get("/analytics")
def get_traffic_analytics(
    lat: float = Query(13.0827, description="Center latitude coordinate"),
    lng: float = Query(80.2707, description="Center longitude coordinate"),
    min_lon: Optional[float] = Query(None, description="Minimum longitude (West)"),
    min_lat: Optional[float] = Query(None, description="Minimum latitude (South)"),
    max_lon: Optional[float] = Query(None, description="Maximum longitude (East)"),
    max_lat: Optional[float] = Query(None, description="Maximum latitude (North)"),
    location_name: Optional[str] = Query(None, description="Human-readable location title"),
):
    """
    Aggregates real-time traffic flow and incidents into high-level corridor analytics:
    congestion level, average speed, incident breakdown, slow segments, and delays.
    """
    service = get_tomtom_service()
    res = service.get_traffic_analytics(
        latitude=lat,
        longitude=lng,
        min_lon=min_lon,
        min_lat=min_lat,
        max_lon=max_lon,
        max_lat=max_lat,
        location_name=location_name,
    )
    return res


@router.get("/tiles/flow/{z}/{x}/{y}.png")
def get_flow_tile(z: int, x: int, y: int):
    """
    Secure server-side proxy for TomTom Traffic Flow raster tiles.
    Client browsers receive the rendered traffic tile without exposing the TomTom API key.
    """
    service = get_tomtom_service()
    tile_bytes = service.get_flow_tile(z=z, x=x, y=y)
    if not tile_bytes:
        # Return 1x1 transparent PNG if tile unavailable
        transparent_png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
            b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        return Response(content=transparent_png, media_type="image/png", status_code=status.HTTP_200_OK)
    return Response(content=tile_bytes, media_type="image/png")


@router.get("/tiles/incidents/{z}/{x}/{y}.png")
def get_incident_tile(z: int, x: int, y: int):
    """
    Secure server-side proxy for TomTom Traffic Incidents raster tiles.
    """
    service = get_tomtom_service()
    tile_bytes = service.get_incident_tile(z=z, x=x, y=y)
    if not tile_bytes:
        transparent_png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
            b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        return Response(content=transparent_png, media_type="image/png", status_code=status.HTTP_200_OK)
    return Response(content=tile_bytes, media_type="image/png")

