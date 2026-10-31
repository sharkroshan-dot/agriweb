from fastapi.testclient import TestClient

from app.main import app


def test_api_docs_uses_fastapi_openapi_url():
    response = TestClient(app).get("/api/docs")

    assert response.status_code == 200
    assert "/openapi.json" in response.text
    assert "API inventory" in response.text
