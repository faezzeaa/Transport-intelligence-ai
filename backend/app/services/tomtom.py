import logging
import time
from typing import Any, Dict, List, Optional, Tuple
import certifi
import httpx

from app.config import get_settings

logger = logging.getLogger("transport_ai.tomtom")
settings = get_settings()

FLOW_SEGMENT_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json"
INCIDENTS_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails"
FLOW_TILE_URL = "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png"
INCIDENT_TILE_URL = "https://api.tomtom.com/traffic/map/4/tile/incidents/s0/{z}/{x}/{y}.png"


def mask_secret(val: Optional[str]) -> str:
    """Mask secret for safe diagnostic logging without leaking keys."""
    if not val:
        return "not_configured"
    val = val.strip()
    if len(val) <= 8:
        return "******"
    return f"{val[:4]}...{val[-4:]}"


# TomTom iconCategory to unified IncidentCategory mapping
ICON_CATEGORY_MAP: Dict[int, Tuple[str, str]] = {
    0: ("HAZARD", "LOW"),            # Unknown
    1: ("ACCIDENT", "CRITICAL"),      # Accident
    2: ("WEATHER", "MEDIUM"),         # Fog
    3: ("HAZARD", "HIGH"),            # Dangerous Conditions
    4: ("WEATHER", "LOW"),            # Rain
    5: ("WEATHER", "MEDIUM"),         # Ice
    6: ("CONGESTION", "HIGH"),        # Jam
    7: ("CLOSURE", "HIGH"),           # Lane Closed
    8: ("CLOSURE", "CRITICAL"),       # Road Closed
    9: ("ROADWORK", "MEDIUM"),        # Road Works
    10: ("WEATHER", "LOW"),           # Wind
    11: ("WEATHER", "HIGH"),          # Flooding
    14: ("HAZARD", "MEDIUM"),         # Broken Down Vehicle
}

CATEGORY_LABELS: Dict[int, str] = {
    0: "Hazard / Notice",
    1: "Vehicle Accident",
    2: "Fog Hazard",
    3: "Dangerous Road Conditions",
    4: "Heavy Rain Advisory",
    5: "Icy Road Advisory",
    6: "Traffic Jam / Congestion",
    7: "Lane Closure",
    8: "Road Closure",
    9: "Active Roadwork",
    10: "High Wind Advisory",
    11: "Flooding Incident",
    14: "Disabled Vehicle",
}


class TomTomService:
    """
    Enterprise Geospatial & Live Traffic Service for TomTom API.
    Handles Flow Segment queries, Incident Details ingestion, and secure
    server-side tile proxying without exposing API keys to client browsers.
    """

    def __init__(self):
        self._last_status_check: float = 0.0
        self._cached_status: Optional[Dict[str, Any]] = None
        self._flow_cache: Dict[str, Any] = {}
        self._incident_cache: Dict[str, Any] = {}

    @property
    def api_key(self) -> str:
        return (settings.TOMTOM_API_KEY or "").strip()

    def is_configured(self) -> bool:
        return bool(self.api_key and not self.api_key.lower().startswith("your_"))

    def _get_http_client(self, timeout: float = 10.0) -> httpx.Client:
        """Create configured HTTP client with certificate validation."""
        try:
            return httpx.Client(verify=certifi.where(), timeout=timeout)
        except Exception:
            # Fallback for environments with strict local inspection proxies
            return httpx.Client(verify=False, timeout=timeout)

    def get_status(self) -> Dict[str, Any]:
        """
        Returns full diagnostic status of TomTom integration without exposing the secret.
        """
        now = time.time()
        if self._cached_status and (now - self._last_status_check < 30.0):
            return self._cached_status

        if not self.is_configured():
            status_data = {
                "provider": "TomTom Traffic",
                "status": "NOT_CONFIGURED",
                "is_configured": False,
                "is_operational": False,
                "masked_api_key": "not_configured",
                "capabilities": [],
                "diagnostic_message": "TOMTOM_API_KEY is not configured in backend/.env.",
                "attribution": "© TomTom International BV",
            }
            self._cached_status = status_data
            self._last_status_check = now
            return status_data

        # Verify key with lightweight point probe (Chennai Anna Salai / arterial corridor)
        test_url = f"{FLOW_SEGMENT_URL}?point=13.0827,80.2707&unit=KMPH&key={self.api_key}"
        try:
            with self._get_http_client(timeout=8.0) as client:
                res = client.get(test_url)
                if res.status_code == 200:
                    status_data = {
                        "provider": "TomTom Traffic",
                        "status": "OPERATIONAL",
                        "is_configured": True,
                        "is_operational": True,
                        "masked_api_key": mask_secret(self.api_key),
                        "capabilities": [
                            "realtime_flow_segment",
                            "traffic_incidents_feed",
                            "traffic_flow_tiles",
                            "incident_map_tiles",
                        ],
                        "diagnostic_message": "TomTom Traffic API key verified and operational.",
                        "attribution": "© TomTom International BV",
                    }
                elif res.status_code in (401, 403):
                    status_data = {
                        "provider": "TomTom Traffic",
                        "status": "AUTH_FAILED",
                        "is_configured": True,
                        "is_operational": False,
                        "masked_api_key": mask_secret(self.api_key),
                        "capabilities": [],
                        "diagnostic_message": f"TomTom API rejected credentials (HTTP {res.status_code}). Verify your TOMTOM_API_KEY.",
                        "attribution": "© TomTom International BV",
                    }
                else:
                    status_data = {
                        "provider": "TomTom Traffic",
                        "status": "DEGRADED",
                        "is_configured": True,
                        "is_operational": False,
                        "masked_api_key": mask_secret(self.api_key),
                        "capabilities": [],
                        "diagnostic_message": f"TomTom API returned HTTP {res.status_code}",
                        "attribution": "© TomTom International BV",
                    }
        except Exception as exc:
            logger.warning("[TomTomService] Status probe failed: %s", exc)
            status_data = {
                "provider": "TomTom Traffic",
                "status": "NETWORK_ERROR",
                "is_configured": True,
                "is_operational": False,
                "masked_api_key": mask_secret(self.api_key),
                "capabilities": [],
                "diagnostic_message": f"Network error connecting to TomTom API: {type(exc).__name__}",
                "attribution": "© TomTom International BV",
            }

        self._cached_status = status_data
        self._last_status_check = now
        return status_data

    def get_flow_segment(self, latitude: float, longitude: float, unit: str = "KMPH") -> Dict[str, Any]:
        """
        Retrieves real-time traffic flow speed, congestion level, and corridor metrics
        for a specific geographic coordinate. Cached for 30s to respect API rate limits.
        """
        if not self.is_configured():
            return {
                "success": False,
                "error": "TOMTOM_API_KEY is not configured.",
                "provider": "tomtom",
                "flow": None,
            }

        cache_key = f"{round(latitude, 4)}_{round(longitude, 4)}_{unit}"
        now = time.time()
        if cache_key in self._flow_cache:
            entry = self._flow_cache[cache_key]
            if (now - entry["timestamp"]) < 30.0:
                return entry["data"]

        url = f"{FLOW_SEGMENT_URL}?point={latitude},{longitude}&unit={unit}&key={self.api_key}"
        try:
            with self._get_http_client(timeout=10.0) as client:
                res = client.get(url)
                if res.status_code != 200:
                    return {
                        "success": False,
                        "http_status_code": res.status_code,
                        "error": f"TomTom Flow API returned HTTP {res.status_code}",
                        "provider": "tomtom",
                        "flow": None,
                    }

                data = res.json().get("flowSegmentData", {})
                current_speed = data.get("currentSpeed", 0.0)
                free_flow_speed = data.get("freeFlowSpeed", 0.0)
                current_tt = data.get("currentTravelTime", 0.0)
                free_flow_tt = data.get("freeFlowTravelTime", 0.0)
                confidence = data.get("confidence", 1.0)
                road_closure = data.get("roadClosure", False)

                # Compute congestion level percentage
                congestion_pct = 0.0
                if free_flow_speed > 0:
                    congestion_pct = max(0.0, min(100.0, (1.0 - (current_speed / free_flow_speed)) * 100.0))

                raw_coords = data.get("coordinates", {}).get("coordinate", [])
                coordinates = [[c.get("longitude"), c.get("latitude")] for c in raw_coords if "longitude" in c and "latitude" in c]

                result = {
                    "success": True,
                    "provider": "tomtom",
                    "latitude": latitude,
                    "longitude": longitude,
                    "unit": unit,
                    "flow": {
                        "current_speed": current_speed,
                        "free_flow_speed": free_flow_speed,
                        "congestion_pct": round(congestion_pct, 1),
                        "current_travel_time_sec": current_tt,
                        "free_flow_travel_time_sec": free_flow_tt,
                        "confidence": confidence,
                        "road_closure": road_closure,
                        "frc": data.get("frc", "UNKNOWN"),
                        "coordinates": coordinates,
                    },
                    "attribution": "© TomTom International BV",
                }
                self._flow_cache[cache_key] = {"timestamp": now, "data": result}
                return result
        except Exception as exc:
            logger.error("[TomTomService] Flow query failed: %s", exc)
            return {
                "success": False,
                "error": f"Failed to retrieve flow data: {str(exc)}",
                "provider": "tomtom",
                "flow": None,
            }

    def get_incidents(
        self,
        min_lon: float = 80.15,
        min_lat: float = 12.95,
        max_lon: float = 80.35,
        max_lat: float = 13.15,
    ) -> Dict[str, Any]:
        """
        Retrieves live traffic incidents (accidents, congestion, roadworks, closures)
        within the requested bounding box. Automatically clamps oversized bounding boxes
        to adhere to TomTom's 10,000 km2 max API limit. Cached for 30 seconds.
        """
        if not self.is_configured():
            return {
                "success": False,
                "error": "TOMTOM_API_KEY is not configured.",
                "provider": "tomtom",
                "incidents_count": 0,
                "incidents": [],
            }

        # Validate coordinate bounds
        if min_lon > max_lon:
            min_lon, max_lon = max_lon, min_lon
        if min_lat > max_lat:
            min_lat, max_lat = max_lat, min_lat

        mid_lon = (min_lon + max_lon) / 2.0
        mid_lat = (min_lat + max_lat) / 2.0
        span_lon = abs(max_lon - min_lon)
        span_lat = abs(max_lat - min_lat)

        import math
        lat_km = span_lat * 111.0
        lon_km = span_lon * 111.0 * max(0.2, math.cos(math.radians(mid_lat)))
        approx_area_km2 = lat_km * lon_km

        is_clamped = False
        # TomTom enforces a strict 10,000 km2 limit per query. Clamp if approaching 8,500 km2.
        if approx_area_km2 > 8500.0 or span_lon > 0.8 or span_lat > 0.8:
            max_half_deg = 0.38
            min_lon = round(mid_lon - max_half_deg, 4)
            max_lon = round(mid_lon + max_half_deg, 4)
            min_lat = round(mid_lat - max_half_deg, 4)
            max_lat = round(mid_lat + max_half_deg, 4)
            is_clamped = True

        cache_key = f"{round(min_lon, 3)}_{round(min_lat, 3)}_{round(max_lon, 3)}_{round(max_lat, 3)}"
        now = time.time()
        if cache_key in self._incident_cache:
            entry = self._incident_cache[cache_key]
            if (now - entry["timestamp"]) < 30.0:
                return entry["data"]

        fields = (
            "{incidents{type,geometry{type,coordinates},"
            "properties{id,iconCategory,magnitudeOfDelay,events{description,code},"
            "startTime,endTime,from,to,length,delay,roadNumbers}}}"
        )
        url = (
            f"{INCIDENTS_URL}?bbox={min_lon},{min_lat},{max_lon},{max_lat}"
            f"&fields={fields}&language=en-GB&key={self.api_key}"
        )

        try:
            with self._get_http_client(timeout=12.0) as client:
                res = client.get(url)
                if res.status_code != 200:
                    return {
                        "success": False,
                        "http_status_code": res.status_code,
                        "error": f"TomTom Incidents API returned HTTP {res.status_code}",
                        "provider": "tomtom",
                        "incidents_count": 0,
                        "incidents": [],
                    }

                raw_incidents = res.json().get("incidents", [])
                normalized: List[Dict[str, Any]] = []

                for item in raw_incidents:
                    props = item.get("properties", {})
                    geom = item.get("geometry", {})
                    icon_cat = props.get("iconCategory", 0)
                    cat_name, sev_name = ICON_CATEGORY_MAP.get(icon_cat, ("HAZARD", "MEDIUM"))
                    cat_label = CATEGORY_LABELS.get(icon_cat, "Traffic Incident")

                    road_nums = props.get("roadNumbers", [])
                    road_str = ", ".join(road_nums) if road_nums else (props.get("from") or "Transit Corridor")

                    events = props.get("events", [])
                    event_descs = [e.get("description", "") for e in events if e.get("description")]
                    description = "; ".join(event_descs) if event_descs else f"Live {cat_label} verified by TomTom Traffic."

                    coords = geom.get("coordinates", [])
                    lat, lng = 0.0, 0.0
                    if geom.get("type") == "Point" and len(coords) >= 2:
                        lng, lat = float(coords[0]), float(coords[1])
                    elif geom.get("type") == "LineString" and len(coords) >= 1:
                        mid_idx = len(coords) // 2
                        lng, lat = float(coords[mid_idx][0]), float(coords[mid_idx][1])

                    delay_sec = props.get("delay") or 0

                    normalized.append({
                        "id": props.get("id"),
                        "title": f"{cat_label} on {road_str}",
                        "description": description,
                        "category": cat_name,
                        "severity": sev_name,
                        "latitude": lat,
                        "longitude": lng,
                        "location_name": f"{props.get('from', '')} -> {props.get('to', '')}".strip(" -> ") or road_str,
                        "delay_seconds": delay_sec,
                        "magnitude_of_delay": props.get("magnitudeOfDelay", 0),
                        "length_meters": props.get("length", 0),
                        "geometry": geom,
                        "start_time": props.get("startTime"),
                        "end_time": props.get("endTime"),
                        "is_simulated": False,
                        "data_source": "TomTom Live Traffic API",
                    })

                result = {
                    "success": True,
                    "provider": "tomtom",
                    "bbox": [min_lon, min_lat, max_lon, max_lat],
                    "is_clamped": is_clamped,
                    "incidents_count": len(normalized),
                    "incidents": normalized,
                    "attribution": "© TomTom International BV",
                }
                self._incident_cache[cache_key] = {"timestamp": now, "data": result}
                return result
        except Exception as exc:
            logger.error("[TomTomService] Incidents query failed: %s", exc)
            return {
                "success": False,
                "error": f"Failed to retrieve incidents: {str(exc)}",
                "provider": "tomtom",
                "incidents_count": 0,
                "incidents": [],
            }

    def get_traffic_analytics(
        self,
        latitude: float,
        longitude: float,
        min_lon: Optional[float] = None,
        min_lat: Optional[float] = None,
        max_lon: Optional[float] = None,
        max_lat: Optional[float] = None,
        location_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates aggregated live traffic analytics for the visible viewport or region:
        - Real-time congestion index and speed comparison
        - Live incident counts and breakdown by category
        - Slow corridors and delay rankings
        - Live sync timestamp and coverage confidence
        """
        import datetime

        # Default bounding box: +/- 0.2 degrees around point if not provided
        if min_lon is None or min_lat is None or max_lon is None or max_lat is None:
            min_lon = longitude - 0.20
            max_lon = longitude + 0.20
            min_lat = latitude - 0.20
            max_lat = latitude + 0.20

        flow_res = self.get_flow_segment(latitude, longitude)
        inc_res = self.get_incidents(min_lon, min_lat, max_lon, max_lat)

        flow = flow_res.get("flow") or {}
        incidents = inc_res.get("incidents") or []

        curr_speed = flow.get("current_speed")
        free_speed = flow.get("free_flow_speed")
        flow_congestion = flow.get("congestion_pct", 0.0)
        confidence = flow.get("confidence", 1.0)
        curr_tt = flow.get("current_travel_time_sec", 0.0)
        free_tt = flow.get("free_flow_travel_time_sec", 0.0)
        point_delay = max(0.0, curr_tt - free_tt)

        breakdown = {
            "accidents": 0,
            "congestion_jams": 0,
            "roadworks": 0,
            "road_closures": 0,
            "hazards": 0,
        }

        slow_segments: List[Dict[str, Any]] = []
        total_delay_sec = point_delay

        for item in incidents:
            cat = item.get("category", "")
            d_sec = item.get("delay_seconds") or 0
            total_delay_sec += d_sec

            if cat == "ACCIDENT":
                breakdown["accidents"] += 1
            elif cat == "CONGESTION":
                breakdown["congestion_jams"] += 1
            elif cat == "ROADWORK":
                breakdown["roadworks"] += 1
            elif cat == "CLOSURE":
                breakdown["road_closures"] += 1
            else:
                breakdown["hazards"] += 1

            if d_sec > 0 or item.get("magnitude_of_delay", 0) >= 2 or item.get("severity") in ("CRITICAL", "HIGH"):
                slow_segments.append({
                    "id": item.get("id"),
                    "road": item.get("location_name") or item.get("title"),
                    "delay_seconds": d_sec,
                    "delay_minutes": round(d_sec / 60.0, 1),
                    "severity": item.get("severity"),
                    "category": item.get("category"),
                    "description": item.get("description"),
                    "latitude": item.get("latitude"),
                    "longitude": item.get("longitude"),
                })

        slow_segments.sort(key=lambda x: x["delay_seconds"], reverse=True)

        # Composite congestion index
        composite_cong = flow_congestion
        if breakdown["congestion_jams"] > 0:
            composite_cong = max(composite_cong, min(95.0, flow_congestion + (breakdown["congestion_jams"] * 3.5)))
        elif breakdown["road_closures"] > 10:
            composite_cong = max(composite_cong, min(90.0, flow_congestion + 15.0))

        if composite_cong < 15.0:
            cong_level = "OPTIMAL_FLOW"
            cong_label = "Optimal / Free Flow"
            cong_color = "emerald"
        elif composite_cong < 35.0:
            cong_level = "MODERATE"
            cong_label = "Moderate Flow"
            cong_color = "sky"
        elif composite_cong < 65.0:
            cong_level = "HEAVY"
            cong_label = "Heavy Traffic"
            cong_color = "amber"
        else:
            cong_level = "SEVERE"
            cong_label = "Severe Congestion"
            cong_color = "rose"

        # Determine coverage reliability
        if not self.is_configured():
            cov_status = "NOT_CONFIGURED"
        elif flow.get("frc") == "UNKNOWN" and len(incidents) == 0:
            cov_status = "LOW_DENSITY_ROAD"
        else:
            cov_status = "VERIFIED_LIVE"

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

        return {
            "success": True,
            "provider": "tomtom",
            "location_name": location_name or f"{latitude:.4f}° N, {longitude:.4f}° E",
            "center": [latitude, longitude],
            "bbox": inc_res.get("bbox", [min_lon, min_lat, max_lon, max_lat]),
            "is_clamped": inc_res.get("is_clamped", False),
            "timestamp": now_iso,
            "coverage_status": cov_status,
            "metrics": {
                "congestion_pct": round(composite_cong, 1),
                "congestion_level": cong_level,
                "congestion_label": cong_label,
                "congestion_color": cong_color,
                "current_speed_kmh": curr_speed,
                "free_flow_speed_kmh": free_speed,
                "speed_ratio_pct": round((curr_speed / free_speed) * 100.0, 1) if (curr_speed and free_speed and free_speed > 0) else None,
                "total_delay_seconds": int(total_delay_sec),
                "total_delay_minutes": round(total_delay_sec / 60.0, 1),
                "total_incidents": len(incidents),
                "incident_breakdown": breakdown,
                "confidence": confidence,
            },
            "slow_segments": slow_segments[:6],
            "attribution": "© TomTom Live Traffic Intelligence",
        }

    def get_flow_tile(self, z: int, x: int, y: int) -> Optional[bytes]:
        """
        Proxies TomTom Traffic Flow raster tile PNG.
        Never exposes the secret key to the client browser.
        """
        if not self.is_configured():
            return None

        url = FLOW_TILE_URL.format(z=z, x=x, y=y) + f"?key={self.api_key}"
        try:
            with self._get_http_client(timeout=8.0) as client:
                res = client.get(url)
                if res.status_code == 200:
                    return res.content
                return None
        except Exception:
            return None

    def get_incident_tile(self, z: int, x: int, y: int) -> Optional[bytes]:
        """
        Proxies TomTom Traffic Incidents raster tile PNG.
        Never exposes the secret key to the client browser.
        """
        if not self.is_configured():
            return None

        url = INCIDENT_TILE_URL.format(z=z, x=x, y=y) + f"?key={self.api_key}"
        try:
            with self._get_http_client(timeout=8.0) as client:
                res = client.get(url)
                if res.status_code == 200:
                    return res.content
                return None
        except Exception:
            return None


# Global singleton
_tomtom_service: Optional[TomTomService] = None


def get_tomtom_service() -> TomTomService:
    global _tomtom_service
    if _tomtom_service is None:
        _tomtom_service = TomTomService()
    return _tomtom_service

