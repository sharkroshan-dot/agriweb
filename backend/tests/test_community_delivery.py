import pytest

from app.schemas.community_delivery import CommunityDeliveryScheduleCreate
from app.services import community_delivery_service as community_delivery_module


class DummyCommunityDeliveryRepository:
    def __init__(self):
        self.created = []

    async def create_schedule(self, data):
        self.created.append(data)
        return {
            "id": "schedule-1",
            **data,
        }

    async def get_by_farmer_id(self, farmer_id):
        return [item for item in self.created if item.get("farmerId") == farmer_id]


@pytest.mark.asyncio
async def test_create_schedule_assigns_farmer_and_status(monkeypatch):
    dummy_repository = DummyCommunityDeliveryRepository()
    monkeypatch.setattr(community_delivery_module, "community_delivery_repository", dummy_repository)

    payload = CommunityDeliveryScheduleCreate(
        areaName="Annur",
        dayOfWeek="tuesday",
        windowStart="06:00",
        windowEnd="09:00",
        radiusKm=10,
        description="Weekly community drop-off",
        latitude=11.23,
        longitude=77.34,
    )

    schedule = await community_delivery_module.CommunityDeliveryService.create_schedule(
        "farmer-123",
        payload,
    )

    assert schedule["farmerId"] == "farmer-123"
    assert schedule["status"] == "active"
    assert schedule["areaName"] == "Annur"
