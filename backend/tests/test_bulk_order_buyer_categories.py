"""Regression tests for bulk/event buyer categories and sourcing route selection."""
import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.api.v1 import bulk_orders as bulk_module


def request_payload(**overrides):
    payload = {
        "requestType": "bulk_event",
        "buyerCategory": "event_organizer",
        "purpose": "Community event",
        "purchaseMode": "event",
        "requestedDeliveryDate": "2026-11-01",
        "deliveryCity": "Coimbatore",
        "items": [{"name": "Tomato", "quantityKg": 100, "qualityGrade": "Grade A"}],
    }
    payload.update(overrides)
    return bulk_module.BulkRequestCreate(**payload)


@pytest.fixture
def create_request_dependencies(monkeypatch):
    request_id = str(ObjectId())
    captured = {}

    async def fake_create(payload):
        captured.update(payload)
        return request_id

    async def fake_resolve_address(user_id, data):
        return {
            "addressLine1": "Test delivery address",
            "city": data.deliveryCity,
            "location": None,
        }

    monkeypatch.setattr(bulk_module.request_repo, "create", fake_create)
    monkeypatch.setattr(bulk_module, "_resolve_delivery_address", fake_resolve_address)
    monkeypatch.setattr(
        bulk_module.BulkOrderService,
        "request_number",
        staticmethod(lambda: "BULK-TEST-0001"),
    )
    return captured


@pytest.mark.asyncio
async def test_event_organizer_request_uses_bulk_event(create_request_dependencies):
    result = await bulk_module.create_request(
        request_payload(),
        current_user={"_id": str(ObjectId()), "role": "customer", "firstName": "A Buyer"},
    )

    assert result["success"] is True
    assert result["data"]["buyerCategory"] == "event_organizer"
    assert result["data"]["requestType"] == "bulk_event"
    assert result["data"]["items"][0]["name"] == "Tomato"
    assert result["data"]["items"][0]["quantityKg"] == 100


@pytest.mark.asyncio
async def test_institution_request_uses_b2b_and_keeps_organization(create_request_dependencies):
    result = await bulk_module.create_request(
        request_payload(
            buyerCategory="institution",
            organizationName="Coimbatore Community Kitchen",
            organizationType="Community Kitchen",
            requestType="bulk_event",
        ),
        current_user={"_id": str(ObjectId()), "role": "customer", "firstName": "Coordinator"},
    )

    assert result["data"]["buyerCategory"] == "institution"
    assert result["data"]["requestType"] == "b2b"
    assert result["data"]["organizationName"] == "Coimbatore Community Kitchen"
    assert result["data"]["organizationType"] == "Community Kitchen"


@pytest.mark.asyncio
async def test_business_role_is_forced_to_business_category(create_request_dependencies):
    result = await bulk_module.create_request(
        request_payload(
            buyerCategory="event_organizer",
            organizationName=None,
        ),
        current_user={
            "_id": str(ObjectId()),
            "role": "business",
            "firstName": "Green Leaf",
            "businessName": "Green Leaf Hotel",
        },
    )

    assert result["data"]["buyerCategory"] == "business"
    assert result["data"]["buyerType"] == "business"
    assert result["data"]["requestType"] == "b2b"
    assert result["data"]["organizationName"] == "Green Leaf Hotel"


@pytest.mark.asyncio
async def test_institution_requires_organization_name(create_request_dependencies):
    with pytest.raises(HTTPException) as exc:
        await bulk_module.create_request(
            request_payload(buyerCategory="institution", organizationName=None),
            current_user={"_id": str(ObjectId()), "role": "customer", "firstName": "Coordinator"},
        )

    assert exc.value.status_code == 400
    assert "Organization name is required" in exc.value.detail


@pytest.mark.asyncio
async def test_weekly_family_basket_stays_bulk_event(create_request_dependencies):
    result = await bulk_module.create_request(
        request_payload(
            buyerCategory="individual",
            purchaseMode="family_weekly",
            familySize=4,
            deliveryDay="Saturday",
        ),
        current_user={"_id": str(ObjectId()), "role": "customer", "firstName": "Household"},
    )

    assert result["data"]["buyerCategory"] == "individual"
    assert result["data"]["requestType"] == "bulk_event"
    assert result["data"]["isManualWeeklyFamilyBasket"] is True


@pytest.mark.asyncio
async def test_unsupported_buyer_category_is_rejected(create_request_dependencies):
    with pytest.raises(HTTPException) as exc:
        await bulk_module.create_request(
            request_payload(buyerCategory="unknown"),
            current_user={"_id": str(ObjectId()), "role": "customer", "firstName": "Buyer"},
        )

    assert exc.value.status_code == 400
    assert "buyerCategory must be" in exc.value.detail



@pytest.mark.asyncio
async def test_tracking_summarizes_multi_farmer_product_portions(monkeypatch):
    request_id = ObjectId()
    buyer_id = ObjectId()
    request = {
        "_id": request_id,
        "buyerUserId": buyer_id,
        "buyerCategory": "institution",
        "requestType": "b2b",
        "organizationName": "Coimbatore Community Kitchen",
        "purpose": "Weekly kitchen supply",
        "status": "open",
        "eventLocalHubStatus": "in_transit",
        "items": [
            {"name": "Tomato", "quantityKg": 100, "category": "Vegetable", "qualityGrade": "Grade A"},
            {"name": "Onion", "quantityKg": 40, "category": "Vegetable", "qualityGrade": "Standard"},
        ],
    }
    fulfillments = [
        {"_id": ObjectId(), "requestId": request_id, "productName": "Tomato", "farmerId": "farmer-a", "farmName": "Farm A", "allocatedQuantityKg": 60, "status": "packed", "collectionStatus": "pending"},
        {"_id": ObjectId(), "requestId": request_id, "productName": "Tomato", "farmerId": "farmer-b", "farmName": "Farm B", "allocatedQuantityKg": 25, "status": "ready_for_collection", "collectionStatus": "ready"},
        {"_id": ObjectId(), "requestId": request_id, "productName": "Onion", "farmerId": "farmer-c", "farmName": "Farm C", "allocatedQuantityKg": 40, "status": "packed", "collectionStatus": "pending"},
    ]

    async def fake_find_request(query):
        return request

    async def fake_find_fulfillments(query, **kwargs):
        return fulfillments

    async def fake_find_orders(query, **kwargs):
        return []

    async def fake_stringify_fulfillment(row):
        return {**row, "id": str(row["_id"])}

    class FakeDeliveryRepo:
        def __init__(self, name):
            assert name == "delivery_jobs"

        async def find_many(self, query, **kwargs):
            return []

    monkeypatch.setattr(bulk_module.request_repo, "find_one", fake_find_request)
    monkeypatch.setattr(bulk_module.event_fulfillment_repo, "find_many", fake_find_fulfillments)
    monkeypatch.setattr(bulk_module.order_repo, "find_many", fake_find_orders)
    monkeypatch.setattr(bulk_module, "BaseRepository", FakeDeliveryRepo)
    monkeypatch.setattr(bulk_module, "_stringify_event_fulfillment", fake_stringify_fulfillment)

    result = await bulk_module.bulk_order_tracking(
        str(request_id),
        current_user={"_id": str(buyer_id), "role": "customer"},
    )
    data = result["data"]
    by_name = {item["productName"]: item for item in data["productSummary"]}

    assert data["currentStage"] == "local_hub_receipt"
    assert by_name["Tomato"]["requestedQuantityKg"] == 100
    assert by_name["Tomato"]["allocatedQuantityKg"] == 85
    assert by_name["Tomato"]["remainingQuantityKg"] == 15
    assert by_name["Tomato"]["sourceCount"] == 2
    assert by_name["Tomato"]["status"] == "partially_sourced"
    assert by_name["Onion"]["allocatedQuantityKg"] == 40
    assert by_name["Onion"]["remainingQuantityKg"] == 0
    assert by_name["Onion"]["status"] == "complete"



@pytest.mark.parametrize(
    ("incoming_record", "expected_message"),
    [
        (
            {"status": "received", "qualityCheck": "rejected", "quantityReceived": 100, "arrivedWarehouseAt": "now"},
            "Approve the quality check",
        ),
        (
            {"status": "stored", "qualityCheck": "passed", "quantityReceived": 79, "arrivedWarehouseAt": "now"},
            "physically received quantity is below",
        ),
    ],
)
@pytest.mark.asyncio
async def test_warehouse_cannot_store_quality_rejected_or_short_portion(
    monkeypatch, incoming_record, expected_message
):
    fulfillment_id = ObjectId()
    request_id = ObjectId()
    warehouse_id = ObjectId()
    fulfillment = {
        "_id": fulfillment_id,
        "requestId": request_id,
        "warehouseId": warehouse_id,
        "productId": ObjectId(),
        "allocatedQuantityKg": 80,
        "status": "warehouse_received",
    }
    request = {"_id": request_id, "eventWarehouseId": str(warehouse_id)}

    async def fake_find_fulfillment(query):
        return fulfillment

    async def fake_find_request(query):
        return request

    async def fake_find_incoming(query):
        return incoming_record

    async def fake_get_warehouse(manager_id):
        return {"_id": warehouse_id}

    monkeypatch.setattr(bulk_module.event_fulfillment_repo, "find_one", fake_find_fulfillment)
    monkeypatch.setattr(bulk_module.request_repo, "find_one", fake_find_request)
    monkeypatch.setattr(bulk_module.incoming_stock_repository, "find_one", fake_find_incoming)
    monkeypatch.setattr(bulk_module.WarehouseService, "get_warehouse_by_manager", fake_get_warehouse)

    with pytest.raises(HTTPException) as exc:
        await bulk_module.update_event_fulfillment_status(
            str(fulfillment_id),
            bulk_module.EventFulfillmentStatusUpdate(status="stored"),
            current_user={"_id": str(ObjectId()), "role": "warehouse"},
        )

    assert exc.value.status_code == 409
    assert expected_message.lower() in exc.value.detail.lower()



@pytest.mark.asyncio
async def test_source_confirmation_rejects_missing_product_quantity(monkeypatch):
    request_id = ObjectId()
    buyer_id = ObjectId()
    farmer_id = ObjectId()
    tomato_id = ObjectId()
    onion_id = ObjectId()
    request = {
        "_id": request_id,
        "buyerUserId": buyer_id,
        "status": "open",
        "eventSourcingStatus": "plan_ready",
        "deliveryAddress": {"location": {"coordinates": [76.95, 11.02]}},
        "items": [
            {"name": "Tomato", "quantityKg": 100},
            {"name": "Onion", "quantityKg": 40},
        ],
        "eventSourcingPlan": {
            "plan": [
                {"productName": "Tomato", "allocations": [{"farmerId": str(farmer_id), "productId": str(tomato_id), "quantityKg": 100, "farmName": "Farm A"}]},
                {"productName": "Onion", "allocations": [{"farmerId": str(farmer_id), "productId": str(onion_id), "quantityKg": 40, "farmName": "Farm A"}]},
            ]
        },
    }

    async def fake_find_request(query):
        return request

    monkeypatch.setattr(bulk_module.request_repo, "find_one", fake_find_request)

    with pytest.raises(HTTPException) as exc:
        await bulk_module.confirm_event_source(
            str(request_id),
            bulk_module.EventSourceConfirm(allocations=[{
                "productName": "Tomato",
                "farmerId": str(farmer_id),
                "productId": str(tomato_id),
                "quantityKg": 60,
            }]),
            current_user={"_id": str(buyer_id), "role": "customer"},
        )

    assert exc.value.status_code == 400
    assert "Every event requirement must be fully sourced" in exc.value.detail["message"]
    shortages = {row["productName"]: row["shortageKg"] for row in exc.value.detail["shortages"]}
    assert shortages == {"Tomato": 40.0, "Onion": 40.0}
