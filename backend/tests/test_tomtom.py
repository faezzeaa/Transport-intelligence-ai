import pytest


def test_tomtom_status_endpoint(client):
    response = client.get("/api/tomtom/status")
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "TomTom Traffic"
    assert "is_configured" in data
    assert "is_operational" in data
    assert "masked_api_key" in data
    assert "capabilities" in data


def test_tomtom_flow_endpoint(client):
    # San Francisco coordinate
    response = client.get("/api/tomtom/flow?lat=37.7749&lng=-122.4194")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["provider"] == "tomtom"
    assert "flow" in data
    flow = data["flow"]
    assert "current_speed" in flow
    assert "free_flow_speed" in flow
    assert "congestion_pct" in flow


def test_tomtom_incidents_endpoint(client):
    # San Francisco bounding box
    response = client.get("/api/tomtom/incidents?min_lon=-122.52&min_lat=37.70&max_lon=-122.35&max_lat=37.83")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["provider"] == "tomtom"
    assert "incidents_count" in data
    assert isinstance(data["incidents"], list)
    if data["incidents"]:
        first = data["incidents"][0]
        assert "id" in first
        assert "title" in first
        assert "category" in first
        assert "severity" in first
        assert "latitude" in first
        assert "longitude" in first


def test_tomtom_flow_tile_proxy(client):
    # Zoom 10 tile in San Francisco area
    response = client.get("/api/tomtom/tiles/flow/10/163/395.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert len(response.content) > 0


def test_tomtom_analytics_endpoint(client):
    response = client.get("/api/tomtom/analytics?lat=13.0827&lng=80.2707&location_name=Chennai")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["provider"] == "tomtom"
    assert "metrics" in data
    assert "congestion_pct" in data["metrics"]
    assert "total_incidents" in data["metrics"]
    assert "slow_segments" in data


