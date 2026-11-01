import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from app.config import get_settings

logger = logging.getLogger("transport_ai.mappls")
settings = get_settings()

OAUTH_URL = "https://outpost.mappls.com/api/security/oauth/token"
GEOCODE_URL = "https://atlas.mappls.com/api/places/geocode"
ROUTING_BASE_URL = "https://apis.mappls.com/advancedmaps/v1"


def mask_secret(val: Optional[str]) -> str:
    """Mask secret for safe diagnostic logging without leaking keys."""
    if not val:
        return "not_configured"
    val = val.strip()
    if len(val) <= 8:
        return "******"
    return f"{val[:4]}...{val[-4:]}"


class MapplsService:
    """
    Enterprise Geospatial Integration Service for MapmyIndia / Mappls.
    Handles server-side OAuth2 client credentials grant, places geocoding,
    routing proxying, and graceful basemap fallback states.
    Never leaks raw client secrets in logs, responses, or error traces.
    """

    def __init__(self):
        self._cached_token: Optional[str] = None
        self._token_expiry_timestamp: float = 0.0
        self._last_auth_check_time: float = 0.0
        self._last_status: Optional[Dict[str, Any]] = None

    @property
    def client_id(self) -> str:
        return (settings.MAPPLS_CLIENT_ID or "").strip()

    @property
    def client_secret(self) -> str:
        return (settings.MAPPLS_CLIENT_SECRET or "").strip()

    @property
    def rest_key(self) -> str:
        return (settings.MAPPLS_REST_KEY or "").strip()

    def is_configured(self) -> bool:
        """Determines if any Mappls credentials are provided."""
        return bool(self.client_id and self.client_secret) or bool(self.rest_key)

    def get_token(self, force_refresh: bool = False) -> Tuple[Optional[str], Optional[str], Optional[int]]:
        """
        Retrieves valid OAuth access token from Mappls.
        Returns: (access_token, error_message, http_status_code)
        """
        if not (self.client_id and self.client_secret):
            return None, "Mappls client credentials not configured in environment.", None

        now = time.time()
        # Return cached token if valid for at least 60 more seconds
        if not force_refresh and self._cached_token and now < (self._token_expiry_timestamp - 60):
            return self._cached_token, None, 200

        post_data = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }).encode("utf-8")

        req = urllib.request.Request(
            OAUTH_URL,
            data=post_data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "IntelligentTransportAI/2.0",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    token = data.get("access_token")
                    expires_in = int(data.get("expires_in", 3600))
                    self._cached_token = token
                    self._token_expiry_timestamp = now + expires_in
                    return token, None, 200
                return None, f"Unexpected response from Mappls OAuth: HTTP {response.status}", response.status

        except urllib.error.HTTPError as http_err:
            try:
                body = http_err.read().decode("utf-8")
                parsed = json.loads(body)
                error_desc = parsed.get("error_description") or parsed.get("error") or str(http_err)
            except Exception:
                error_desc = str(http_err)

            err_msg = f"Mappls authentication rejected (HTTP {http_err.code}): {error_desc}"
            logger.warning("[MapplsService] Auth failure: %s", err_msg)
            return None, err_msg, http_err.code

        except Exception as exc:
            err_msg = f"Failed to connect to Mappls auth server: {type(exc).__name__} {str(exc)}"
            logger.warning("[MapplsService] Network exception: %s", err_msg)
            return None, err_msg, 503

    def get_status(self) -> Dict[str, Any]:
        """
        Returns full diagnostic status of Mappls integration without exposing secrets.
        Checks real-time connectivity and credential entitlement against Mappls.
        """
        now = time.time()
        # Cache status checks for 15 seconds to avoid hammering outpost server
        if self._last_status and (now - self._last_auth_check_time < 15):
            return self._last_status

        configured = self.is_configured()
        if not configured:
            res = {
                "provider": "Mappls (MapmyIndia)",
                "status": "NOT_CONFIGURED",
                "is_configured": False,
                "is_operational": False,
                "client_id_present": bool(self.client_id),
                "client_secret_present": bool(self.client_secret),
                "rest_key_present": bool(self.rest_key),
                "masked_client_id": mask_secret(self.client_id),
                "http_status_code": None,
                "diagnostic_message": (
                    "Mappls credentials not set. The platform runs securely with the "
                    "keyless Esri Dark Gray Canvas / OpenStreetMap basemap fallback."
                ),
                "entitled_capabilities": [],
                "fallback_active": True,
                "fallback_provider": "Esri World Dark Gray Canvas (Keyless Public)",
                "attribution": "© MapmyIndia / Mappls • © Esri • © OpenStreetMap contributors",
            }
            self._last_status = res
            self._last_auth_check_time = now
            return res

        # If REST key is provided without OAuth client credentials
        if not (self.client_id and self.client_secret) and self.rest_key:
            test_url = f"https://apis.mappls.com/advancedmaps/v1/{self.rest_key}/still_image?center=8.0883,77.5385&zoom=12&size=100x100"
            req = urllib.request.Request(test_url, headers={"User-Agent": "IntelligentTransportAI/2.0"})
            try:
                with urllib.request.urlopen(req, timeout=6) as response:
                    if response.status == 200:
                        res = {
                            "provider": "Mappls (MapmyIndia)",
                            "status": "OPERATIONAL",
                            "is_configured": True,
                            "is_operational": True,
                            "client_id_present": False,
                            "client_secret_present": False,
                            "rest_key_present": True,
                            "masked_client_id": mask_secret(self.rest_key),
                            "http_status_code": 200,
                            "diagnostic_message": "Mappls Static / REST key verified and operational.",
                            "entitled_capabilities": ["india_basemaps", "web_sdk_styles"],
                            "fallback_active": False,
                            "fallback_provider": "Esri World Dark Gray Canvas (Available on demand)",
                            "attribution": "© MapmyIndia / Mappls • © OpenStreetMap contributors",
                        }
                    else:
                        res = {
                            "provider": "Mappls (MapmyIndia)",
                            "status": "AUTH_FAILED",
                            "is_configured": True,
                            "is_operational": False,
                            "client_id_present": False,
                            "client_secret_present": False,
                            "rest_key_present": True,
                            "masked_client_id": mask_secret(self.rest_key),
                            "http_status_code": response.status,
                            "diagnostic_message": f"Mappls API rejected Static Key (HTTP {response.status}).",
                            "entitled_capabilities": [],
                            "fallback_active": True,
                            "fallback_provider": "Esri World Dark Gray Canvas (Active Fallback)",
                            "attribution": "© MapmyIndia / Mappls • © Esri • © OpenStreetMap contributors",
                        }
            except urllib.error.HTTPError as http_err:
                res = {
                    "provider": "Mappls (MapmyIndia)",
                    "status": "AUTH_FAILED" if http_err.code in (401, 403, 412) else "SERVICE_UNAVAILABLE",
                    "is_configured": True,
                    "is_operational": False,
                    "client_id_present": False,
                    "client_secret_present": False,
                    "rest_key_present": True,
                    "masked_client_id": mask_secret(self.rest_key),
                    "http_status_code": http_err.code,
                    "diagnostic_message": f"Mappls API rejected Static Key with HTTP {http_err.code} (Client credentials expired/invalid). Fallback basemap is active.",
                    "entitled_capabilities": [],
                    "fallback_active": True,
                    "fallback_provider": "Esri World Dark Gray Canvas (Active Fallback)",
                    "attribution": "© MapmyIndia / Mappls • © Esri • © OpenStreetMap contributors",
                }
            except Exception as exc:
                res = {
                    "provider": "Mappls (MapmyIndia)",
                    "status": "SERVICE_UNAVAILABLE",
                    "is_configured": True,
                    "is_operational": False,
                    "client_id_present": False,
                    "client_secret_present": False,
                    "rest_key_present": True,
                    "masked_client_id": mask_secret(self.rest_key),
                    "http_status_code": None,
                    "diagnostic_message": f"Mappls connection probe failed: {str(exc)}",
                    "entitled_capabilities": [],
                    "fallback_active": True,
                    "fallback_provider": "Esri World Dark Gray Canvas (Active Fallback)",
                    "attribution": "© MapmyIndia / Mappls • © Esri • © OpenStreetMap contributors",
                }
            self._last_status = res
            self._last_auth_check_time = now
            return res

        # If OAuth configured, test token retrieval
        token, err_msg, http_code = self.get_token()

        if token:
            res = {
                "provider": "Mappls (MapmyIndia)",
                "status": "OPERATIONAL",
                "is_configured": True,
                "is_operational": True,
                "client_id_present": True,
                "client_secret_present": True,
                "rest_key_present": bool(self.rest_key),
                "masked_client_id": mask_secret(self.client_id),
                "http_status_code": 200,
                "diagnostic_message": "Mappls enterprise credentials verified. Geospatial services operational.",
                "entitled_capabilities": ["geocoding", "places_search", "route_calculation", "india_basemaps"],
                "fallback_active": False,
                "fallback_provider": "Esri World Dark Gray Canvas (Available on demand)",
                "attribution": "© MapmyIndia / Mappls • © OpenStreetMap contributors",
            }
        else:
            res = {
                "provider": "Mappls (MapmyIndia)",
                "status": "AUTH_FAILED" if http_code == 401 else "SERVICE_UNAVAILABLE",
                "is_configured": True,
                "is_operational": False,
                "client_id_present": bool(self.client_id),
                "client_secret_present": bool(self.client_secret),
                "rest_key_present": bool(self.rest_key),
                "masked_client_id": mask_secret(self.client_id),
                "http_status_code": http_code,
                "diagnostic_message": (
                    f"{err_msg}. Incident markers, geospatial analytics, and keyless basemaps remain 100% operational."
                ),
                "entitled_capabilities": [],
                "fallback_active": True,
                "fallback_provider": "Esri World Dark Gray Canvas (Active Fallback)",
                "attribution": "© MapmyIndia / Mappls • © Esri • © OpenStreetMap contributors",
            }

        self._last_status = res
        self._last_auth_check_time = now
        return res

    def geocode(self, query: str) -> Dict[str, Any]:
        """
        Geocodes address or location query via Mappls Geocoding API.
        If credentials invalid, returns clear, honest error without fabricating coordinates.
        """
        query = query.strip()
        if not query:
            return {
                "success": False,
                "provider": "mappls",
                "error": "Address query parameter is required.",
                "results": [],
            }

        token, err_msg, http_code = self.get_token()
        if not token:
            return {
                "success": False,
                "provider": "mappls",
                "http_status_code": http_code,
                "error": err_msg or "Mappls authentication unavailable.",
                "results": [],
                "fallback_active": True,
            }

        encoded_query = urllib.parse.quote(query)
        req_url = f"{GEOCODE_URL}?address={encoded_query}"
        req = urllib.request.Request(
            req_url,
            headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "IntelligentTransportAI/2.0",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                data = json.loads(response.read().decode("utf-8"))
                cop_results = data.get("copResults", [])
                results = []
                for item in cop_results:
                    results.append({
                        "formatted_address": item.get("formattedAddress"),
                        "latitude": float(item.get("latitude", 0.0)),
                        "longitude": float(item.get("longitude", 0.0)),
                        "place_id": item.get("eLoc") or item.get("placeId"),
                        "city": item.get("city"),
                        "state": item.get("state"),
                        "pincode": item.get("pincode"),
                    })

                return {
                    "success": True,
                    "provider": "mappls",
                    "query": query,
                    "results_count": len(results),
                    "results": results,
                    "attribution": "© MapmyIndia / Mappls",
                }
        except urllib.error.HTTPError as http_err:
            return {
                "success": False,
                "provider": "mappls",
                "http_status_code": http_err.code,
                "error": f"Mappls Geocode API returned HTTP {http_err.code}",
                "results": [],
            }
        except Exception as exc:
            return {
                "success": False,
                "provider": "mappls",
                "error": f"Geocoding request failed: {str(exc)}",
                "results": [],
            }

    def calculate_route(
        self,
        start_lng: float,
        start_lat: float,
        end_lng: float,
        end_lat: float,
        profile: str = "driving",
    ) -> Dict[str, Any]:
        """
        Calculates route between two geographic coordinates via Mappls Routing API.
        If credentials invalid, returns structured error without fabricating false routes.
        """
        token, err_msg, http_code = self.get_token()
        # Fallback to REST key if available
        key_or_token = token or self.rest_key

        if not key_or_token:
            return {
                "success": False,
                "provider": "mappls",
                "http_status_code": http_code,
                "error": err_msg or "Mappls routing credentials unavailable.",
                "route": None,
                "fallback_active": True,
            }

        route_url = (
            f"{ROUTING_BASE_URL}/{key_or_token}/route_adv/{profile}/"
            f"{start_lng},{start_lat};{end_lng},{end_lat}?overview=full&geometries=geojson"
        )
        headers = {"User-Agent": "IntelligentTransportAI/2.0"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        req = urllib.request.Request(route_url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))
                routes = data.get("routes", [])
                if not routes:
                    return {
                        "success": False,
                        "provider": "mappls",
                        "error": "No route path found between specified coordinates.",
                        "route": None,
                    }

                primary = routes[0]
                return {
                    "success": True,
                    "provider": "mappls",
                    "distance_meters": primary.get("distance"),
                    "duration_seconds": primary.get("duration"),
                    "geometry": primary.get("geometry"),
                    "attribution": "© MapmyIndia / Mappls",
                }
        except urllib.error.HTTPError as http_err:
            return {
                "success": False,
                "provider": "mappls",
                "http_status_code": http_err.code,
                "error": f"Mappls Route API returned HTTP {http_err.code}",
                "route": None,
            }
        except Exception as exc:
            return {
                "success": False,
                "provider": "mappls",
                "error": f"Route request failed: {str(exc)}",
                "route": None,
            }


# Singleton service instance
_mappls_service: Optional[MapplsService] = None


def get_mappls_service() -> MapplsService:
    global _mappls_service
    if _mappls_service is None:
        _mappls_service = MapplsService()
    return _mappls_service
