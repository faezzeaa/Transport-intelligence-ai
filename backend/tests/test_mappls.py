def test_mappls_status_endpoint(client):
    """Verify Mappls status endpoint returns accurate diagnostic info without leaking secrets."""
    response = client.get("/api/mappls/status")
    assert response.status_code == 200
    data = response.json()
    assert "provider" in data
    assert data["provider"] == "Mappls (MapmyIndia)"
    assert "status" in data
    assert "is_configured" in data
    assert "fallback_active" in data
    assert "attribution" in data
    assert "MapmyIndia" in data["attribution"]
    # Verify no raw secrets are in the response
    raw_response_text = response.text
    assert "greaqntuvlycjnoldsvwniusphemeuoictsr" not in raw_response_text


def test_mappls_geocode_endpoint(client):
    """Test Mappls geocoding endpoint handles queries and returns structured responses."""
    # Min length validation
    invalid_resp = client.get("/api/mappls/geocode?query=a")
    assert invalid_resp.status_code == 422  # validation error for min_length 2

    valid_resp = client.get("/api/mappls/geocode?query=Connaught+Place+Delhi")
    assert valid_resp.status_code == 200
    data = valid_resp.json()
    assert "provider" in data
    assert data["provider"] == "mappls"
    assert "success" in data
    assert "results" in data


def test_mappls_kundalahalli_search_real_results(client):
    """Verify Kundalahalli location search returns authentic results with valid coordinates."""
    response = client.get("/api/mappls/geocode?query=Kundalahalli")
    assert response.status_code == 200
    data = response.json()
    assert data.get("provider") == "mappls"
    assert data.get("success") is True
    assert "results" in data
    results = data["results"]
    assert len(results) > 0, "Expected at least 1 result for Kundalahalli"
    
    first = results[0]
    assert "formatted_address" in first
    assert "latitude" in first
    assert "longitude" in first
    assert first["latitude"] != 0.0
    assert first["longitude"] != 0.0
    # Latitude for Kundalahalli (Bengaluru) should be ~12.9
    assert 12.0 <= first["latitude"] <= 13.5
    # Longitude for Kundalahalli (Bengaluru) should be ~77.7
    assert 77.0 <= first["longitude"] <= 78.5


def test_mappls_search_alias(client):
    """Verify /api/mappls/search alias endpoint works identically."""
    response = client.get("/api/mappls/search?query=Kundalahalli")
    assert response.status_code == 200
    data = response.json()
    assert data.get("success") is True
    assert len(data.get("results", [])) > 0


def test_mappls_route_endpoint(client):
    """Test Mappls routing endpoint handles coordinate requests."""
    payload = {
        "start_lng": 77.2090,
        "start_lat": 28.6139,
        "end_lng": 77.2295,
        "end_lat": 28.6129,
        "profile": "driving",
    }
    response = client.post("/api/mappls/route", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "provider" in data
    assert data["provider"] == "mappls"
    assert "success" in data
