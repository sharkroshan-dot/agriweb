import pytest
from bson import ObjectId

from app.schemas.delivery import (
    DeliveryPartnerCreate,
    DeliveryStatus,
    DeliveryPartnerStatus,
    VehicleType,
)
from app.services import delivery_service as delivery_module
from app.services.delivery_service import DeliveryService


class DummyDeliveryRepository:
    def __init__(self):
        self.profiles = {}
        self.stats = {}

    async def get_by_user_id(self, user_id):
        for profile in self.profiles.values():
            if str(profile.get("userId")) == str(user_id):
                return profile
        return None

    async def get_by_id(self, partner_id):
        return self.profiles.get(str(partner_id))

    async def create_profile(self, data):
        partner_id = "222222222222222222222222"
        data["_id"] = partner_id
        self.profiles[partner_id] = data
        return partner_id

    async def update(self, query, update_data):
        partner_id = str(query.get("_id"))
        profile = self.profiles.get(partner_id)
        if not profile:
            return False
        profile.update(update_data)
        return True

    async def update_status(self, partner_id, status, is_available=True):
        profile = self.profiles.get(str(partner_id))
        if not profile:
            return False
        profile["status"] = status.value if hasattr(status, "value") else status
        profile["isAvailable"] = is_available
        return True

    async def update_location(self, partner_id, location):
        profile = self.profiles.get(str(partner_id))
        if not profile:
            return False
        profile["currentLocation"] = location
        return True

    async def update_rating(self, partner_id, rating):
        profile = self.profiles.get(str(partner_id))
        if not profile:
            return False
        profile["rating"] = rating
        return True

    async def get_available_partners(self, location, radius, limit=1):
        return [
            {"_id": "222222222222222222222222", "isAvailable": True}
        ]

    async def get_partner_stats(self, partner_id):
        return self.stats.get(str(partner_id), {})


class DummyAssignmentRepository:
    def __init__(self):
        self.assignments = {}

    async def get_by_id(self, assignment_id):
        return self.assignments.get(str(assignment_id))

    async def get_by_order_id(self, order_id):
        for assignment in self.assignments.values():
            if str(assignment["orderId"]) == str(order_id):
                return assignment
        return None

    async def create_assignment(self, data):
        assignment_id = "444444444444444444444444"
        data["_id"] = assignment_id
        self.assignments[assignment_id] = data
        return assignment_id

    async def update_status(self, assignment_id, status, extra=None):
        assignment = self.assignments.get(str(assignment_id))
        if not assignment:
            return False
        assignment["status"] = status.value if hasattr(status, "value") else status
        if extra:
            assignment.update(extra)
        return True

    async def get_by_delivery_partner(self, partner_id, status=None, date=None, skip=0, limit=100):
        items = [
            a for a in self.assignments.values()
            if str(a["deliveryPartnerId"]) == str(partner_id)
        ]
        return items[skip:skip + limit]


class DummyOrderRepository:
    def __init__(self):
        self.orders = {}

    async def get_by_id(self, order_id):
        return self.orders.get(str(order_id))

    async def update(self, query, update_data):
        order_id = str(query.get("_id"))
        order = self.orders.get(order_id)
        if not order:
            return False
        order.update(update_data)
        return True

    async def update_order_status(self, order_id, status, partner_id=None, note=None):
        order = self.orders.get(str(order_id))
        if not order:
            return False
        order["orderStatus"] = status
        return True


class DummyRouteRepository:
    async def get_optimized_route(self, start, destinations, vehicle_type):
        return {"optimizedRoute": [], "totalDistance": 0, "totalTime": 0}

    async def create_route(self, data):
        return "route-1"

    async def get_by_delivery_partner(self, partner_id, date=None):
        return []


@pytest.fixture(autouse=True)
def dummy_repos(monkeypatch):
    dummy_delivery = DummyDeliveryRepository()
    dummy_assignment = DummyAssignmentRepository()
    dummy_order = DummyOrderRepository()
    dummy_route = DummyRouteRepository()
    monkeypatch.setattr(delivery_module, "delivery_repository", dummy_delivery)
    monkeypatch.setattr(delivery_module, "delivery_assignment_repository", dummy_assignment)
    monkeypatch.setattr(delivery_module, "order_repository", dummy_order)
    monkeypatch.setattr(delivery_module, "route_repository", dummy_route)

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(delivery_module.NotificationService, "send_delivery_assignment", _noop)
    monkeypatch.setattr(delivery_module.NotificationService, "send_order_delivered", _noop)
    monkeypatch.setattr(delivery_module.NotificationService, "send_delivery_completed", _noop)
    monkeypatch.setattr(delivery_module.PaymentService, "process_delivery_payment", _noop)
    return {
        "delivery": dummy_delivery,
        "assignment": dummy_assignment,
        "order": dummy_order,
    }


def make_partner_payload(**overrides):
    data = {
        "userId": "111111111111111111111111",
        "vehicleType": VehicleType.BIKE,
        "vehicleNumber": "TN37AB1234",
    }
    data.update(overrides)
    return DeliveryPartnerCreate(**data)


@pytest.mark.asyncio
async def test_create_delivery_partner(dummy_repos):
    partner = await DeliveryService.create_delivery_partner(
        "111111111111111111111111",
        make_partner_payload(),
    )

    assert partner is not None
    assert partner["_id"] == "222222222222222222222222"
    assert str(partner["userId"]) == "111111111111111111111111"


@pytest.mark.asyncio
async def test_create_delivery_partner_duplicate_returns_none(dummy_repos):
    await DeliveryService.create_delivery_partner("111111111111111111111111", make_partner_payload())
    second = await DeliveryService.create_delivery_partner("111111111111111111111111", make_partner_payload())

    assert second is None


@pytest.mark.asyncio
async def test_update_status(dummy_repos):
    await DeliveryService.create_delivery_partner("111111111111111111111111", make_partner_payload())

    ok = await DeliveryService.update_status(
        "222222222222222222222222",
        DeliveryPartnerStatus.BUSY,
        is_available=False,
    )

    assert ok is True
    assert dummy_repos["delivery"].profiles["222222222222222222222222"]["status"] == "busy"
    assert dummy_repos["delivery"].profiles["222222222222222222222222"]["isAvailable"] is False


@pytest.mark.asyncio
async def test_assign_delivery_creates_assignment_and_updates_order(dummy_repos):
    dummy_repos["order"].orders["333333333333333333333333"] = {
        "_id": "333333333333333333333333",
        "orderStatus": "confirmed",
        "deliveryAddress": {"location": {"type": "Point", "coordinates": [77.0, 11.0]}},
    }
    await DeliveryService.create_delivery_partner("111111111111111111111111", make_partner_payload())

    assignment = await DeliveryService.assign_delivery("333333333333333333333333")

    assert assignment is not None
    assert assignment["status"] == DeliveryStatus.ASSIGNED
    assert str(assignment["deliveryPartnerId"]) == "222222222222222222222222"
    assert dummy_repos["order"].orders["333333333333333333333333"]["orderStatus"] == "dispatched"


@pytest.mark.asyncio
async def test_assign_delivery_returns_existing_assignment(dummy_repos):
    dummy_repos["order"].orders["333333333333333333333333"] = {"_id": "333333333333333333333333"}
    dummy_repos["assignment"].assignments["444444444444444444444444"] = {
        "_id": "444444444444444444444444",
        "orderId": "333333333333333333333333",
        "deliveryPartnerId": "222222222222222222222222",
        "status": "assigned",
    }

    assignment = await DeliveryService.assign_delivery("333333333333333333333333")

    assert assignment["_id"] == "444444444444444444444444"
    assert dummy_repos["assignment"].assignments["444444444444444444444444"]["status"] == "assigned"


@pytest.mark.asyncio
async def test_complete_assignment_marks_delivered_and_frees_partner(dummy_repos):
    dummy_repos["order"].orders["333333333333333333333333"] = {
        "_id": "333333333333333333333333",
        "orderStatus": "in_transit",
        "customerId": "666666666666666666666666",
    }
    dummy_repos["assignment"].assignments["444444444444444444444444"] = {
        "_id": "444444444444444444444444",
        "orderId": "333333333333333333333333",
        "deliveryPartnerId": "222222222222222222222222",
        "status": "picked_up",
    }
    await DeliveryService.create_delivery_partner("111111111111111111111111", make_partner_payload())

    result = await DeliveryService.complete_assignment("444444444444444444444444", "222222222222222222222222")

    assert result is not None
    assert result["status"] == DeliveryStatus.DELIVERED
    assert dummy_repos["order"].orders["333333333333333333333333"]["orderStatus"] == "delivered"
    assert dummy_repos["delivery"].profiles["222222222222222222222222"]["status"] == "available"
    assert dummy_repos["delivery"].profiles["222222222222222222222222"]["isAvailable"] is True


@pytest.mark.asyncio
async def test_complete_assignment_wrong_partner_returns_none(dummy_repos):
    dummy_repos["order"].orders["333333333333333333333333"] = {"_id": "333333333333333333333333"}
    dummy_repos["assignment"].assignments["444444444444444444444444"] = {
        "_id": "444444444444444444444444",
        "orderId": "333333333333333333333333",
        "deliveryPartnerId": "222222222222222222222222",
        "status": "picked_up",
    }

    result = await DeliveryService.complete_assignment("444444444444444444444444", "555555555555555555555555")

    assert result is None


@pytest.mark.asyncio
async def test_deliver_order_validates_otp(dummy_repos):
    dummy_repos["order"].orders["333333333333333333333333"] = {
        "_id": "333333333333333333333333",
        "orderStatus": "in_transit",
        "customerId": "666666666666666666666666",
    }
    dummy_repos["assignment"].assignments["444444444444444444444444"] = {
        "_id": "444444444444444444444444",
        "orderId": "333333333333333333333333",
        "deliveryPartnerId": "222222222222222222222222",
        "status": "picked_up",
    }

    invalid = await DeliveryService.deliver_order("444444444444444444444444", "222222222222222222222222", "abc")
    assert invalid is None

    ok = await DeliveryService.deliver_order("444444444444444444444444", "222222222222222222222222", "1234")
    assert ok is not None
    assert ok["status"] == DeliveryStatus.DELIVERED


@pytest.mark.asyncio
async def test_get_partner_deliveries_filters_by_partner(dummy_repos):
    dummy_repos["assignment"].assignments["444444444444444444444444"] = {
        "_id": "444444444444444444444444",
        "orderId": "333333333333333333333333",
        "deliveryPartnerId": "222222222222222222222222",
        "status": "delivered",
    }
    dummy_repos["assignment"].assignments["444444444444444444444443"] = {
        "_id": "444444444444444444444443",
        "orderId": "333333333333333333333332",
        "deliveryPartnerId": "222222222222222222222221",
        "status": "delivered",
    }

    deliveries = await DeliveryService.get_partner_deliveries("222222222222222222222222")

    assert len(deliveries) == 1
    assert str(deliveries[0]["deliveryPartnerId"]) == "222222222222222222222222"


@pytest.mark.asyncio
async def test_get_delivery_stats(dummy_repos):
    dummy_repos["delivery"].stats["222222222222222222222222"] = {"totalDeliveries": 12}

    stats = await DeliveryService.get_delivery_stats("222222222222222222222222")

    assert stats == {"totalDeliveries": 12}
