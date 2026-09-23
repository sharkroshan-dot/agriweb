import pytest

from app.services.ai_extended_service import AIExtendedService
from app.services.ai_copilot_service import AICopilotService


@pytest.mark.asyncio
async def test_copilot_brief_has_guardrail_and_fields():
    brief = await AICopilotService.build_brief("customer", {"name": "Asha"})

    assert brief["role"] == "customer"
    assert "guardrail" in brief
    assert "insights" in brief
    assert brief["insights"]

    insight = brief["insights"][0]
    for key in ["model", "confidence", "severity", "reason", "suggestedAction"]:
        assert key in insight


@pytest.mark.asyncio
async def test_disease_detection_is_deterministic():
    request = type("Req", (), {"plantType": "tomato"})()
    result = await AIExtendedService.detect_disease(request)

    assert result["diseaseName"] == "Early Blight"
    assert 0.8 <= result["confidence"] <= 1.0
