"""Feature tests: harvests (A), delivery slots (B), invoice/impact (C),
loyalty/AgriPoints (D), and B2B marketplace (E).

All tests monkeypatch repositories - no MongoDB / network required.
"""
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from app.api.v1 import harvests as harvests_mod
from app.api.v1 import delivery_slots as slots_mod
from app.api.v1 import impact as impact_mod
from app.api.v1 import loyalty as loyalty_mod
from app.api.v1 import b2b as b2b_mod
from app.api.v1 import batches as batches_mod

OID = "507f1f77bcf86cd799439011"
OID2 = "507f1f77bcf86cd799439012"
OID3 = "507f1f77bcf86cd799439013"


def _farmer_user():
    return {"_id": OID, "role": "farmer", "firstName": "Kumar", "lastName": "Rao"}


def _customer_user():
    return {"_id": OID2, "role": "customer", "firstName": "Asha", "lastName": "Devi"}


def _business_user():
    return {"_id": OID3, "role": "business", "firstName": "Bistro", "lastName": "Pvt"}


async def _noop(*a, **k):
    return None


async def _noop_notification(*a, **k):
    return None


# ============ Feature A: Harvest calendar + pre-order + notify ============

@pytest.mark.asyncio
async def test_farmer_creates_harvest_plan(monkeypatch):
    created = {}

    async def fake_create(data):
        created.update(data)
        return OID

    async def fake_find_one(f):
        doc = dict(created)
        doc["_id"] = f.get("_id") or OID
        return doc

    monkeypatch.setattr(harvests_mod.harvest_plan_repo, "create", fake_create)
    monkeypatch.setattr(harvests_mod.harvest_plan_repo, "find_one", fake_find_one)

    from app.api.v1.harvests import HarvestPlanCreate
    data = HarvestPlanCreate(
        cropName="Tomato",
        expectedHarvestDate=datetime.utcnow() + timedelta(days=10),
        expectedQuantityKg=500,
        preOrderPricePerKg=42,
        preOrderEnabled=True,
    )
    result = await harvests_mod.create_harvest_plan(data, _farmer_user())
    assert result["success"] is True
    assert result["data"]["status"] == "preorder"


@pytest.mark.asyncio
async def test_non_farmer_cannot_create_harvest_plan(monkeypatch):
    with pytest.raises(Exception):
        from app.api.v1.harvests import HarvestPlanCreate
        await harvests_mod.create_harvest_plan(
            HarvestPlanCreate(cropName="Onion", expectedHarvestDate=datetime.utcnow() + timedelta(days=5), expectedQuantityKg=100),
            _customer_user(),
        )


@pytest.mark.asyncio
async def test_mark_harvested_confirms_preorders(monkeypatch):
    from bson import ObjectId
    plan = {
        "_id": ObjectId(OID),
        "farmerId": ObjectId(OID),
        "cropName": "Tomato",
        "expectedQuantityKg": 500,
        "status": "preorder",
    }

    async def fake_find_one(f):
        return dict(plan)

    monkeypatch.setattr(harvests_mod.harvest_plan_repo, "find_one", fake_find_one)
    monkeypatch.setattr(harvests_mod.harvest_plan_repo, "update", AsyncMock(return_value=True))
    monkeypatch.setattr(harvests_mod.harvest_notify_repo, "find_many", AsyncMock(return_value=[]))
    harvests_mod.harvest_preorder_repo._collection = AsyncMock()
    monkeypatch.setattr(harvests_mod.harvest_preorder_repo, "count", AsyncMock(return_value=0))
    harvests_mod.harvest_plan_repo._collection = AsyncMock()

    result = await harvests_mod.mark_harvested(OID, _farmer_user())
    assert result["success"] is True
    assert result["data"]["notifiedCount"] == 0


@pytest.mark.asyncio
async def test_preorder_rejects_overbooking(monkeypatch):
    from bson import ObjectId
    plan = {
        "_id": ObjectId(OID),
        "farmerId": ObjectId(OID),
        "cropName": "Tomato",
        "expectedQuantityKg": 100,
        "preOrderPricePerKg": 40,
        "status": "preorder",
        "preOrderCutoff": datetime.utcnow() + timedelta(days=1),
    }

    async def fake_find_one(f):
        return dict(plan)

    async def fake_aggregate(pipeline):
        return [{"total": 90.0}]

    monkeypatch.setattr(harvests_mod.harvest_plan_repo, "find_one", fake_find_one)
    monkeypatch.setattr(harvests_mod.harvest_preorder_repo, "aggregate", fake_aggregate)
    monkeypatch.setattr(harvests_mod.harvest_preorder_repo, "find_one", AsyncMock(return_value=None))
    monkeypatch.setattr(harvests_mod.harvest_preorder_repo, "create", AsyncMock(return_value=None))
    monkeypatch.setattr(harvests_mod.NotificationService, "create_in_app_notification", _noop_notification)

    with pytest.raises(Exception):
        await harvests_mod.create_preorder(OID, quantityKg=50, current_user=_customer_user())


# ============ Feature B: Delivery slot marketplace ============

@pytest.mark.asyncio
async def test_farmer_publishes_delivery_slot(monkeypatch):
    created = {}

    async def fake_create(data):
        created.update(data)
        return OID

    async def fake_find_one(f):
        doc = dict(created)
        doc["_id"] = OID
        return doc

    monkeypatch.setattr(slots_mod.slot_repo, "create", fake_create)
    monkeypatch.setattr(slots_mod.slot_repo, "find_one", fake_find_one)

    from app.api.v1.delivery_slots import DeliverySlotCreate
    data = DeliverySlotCreate(
        area="Coimbatore North",
        date=datetime.utcnow() + timedelta(days=3),
        startTime="07:00",
        endTime="10:00",
        radiusKm=10,
        maxOrders=25,
    )
    result = await slots_mod.create_delivery_slot(data, _farmer_user())
    assert result["success"] is True
    assert result["data"]["status"] == "open"


@pytest.mark.asyncio
async def test_customer_cannot_publish_slot(monkeypatch):
    from app.api.v1.delivery_slots import DeliverySlotCreate
    with pytest.raises(Exception):
        await slots_mod.create_delivery_slot(
            DeliverySlotCreate(area="X", date=datetime.utcnow() + timedelta(days=1), startTime="1", endTime="2"),
            _customer_user(),
        )


@pytest.mark.asyncio
async def test_join_slot_full_rejected(monkeypatch):
    from bson import ObjectId
    slot = {
        "_id": ObjectId(OID),
        "farmerId": ObjectId(OID),
        "area": "Coimbatore North",
        "date": datetime.utcnow() + timedelta(days=2),
        "maxOrders": 25,
        "status": "open",
        "deliveryFee": 0,
        "cutoffTime": None,
    }

    async def fake_find_one(f):
        return dict(slot)

    monkeypatch.setattr(slots_mod.slot_repo, "find_one", fake_find_one)
    monkeypatch.setattr(slots_mod.booking_repo, "count", AsyncMock(return_value=25))
    monkeypatch.setattr(slots_mod.booking_repo, "find_one", AsyncMock(return_value=None))

    with pytest.raises(Exception):
        await slots_mod.join_delivery_slot(OID, _customer_user())


# ============ Feature C: Invoice + sustainability impact ============

@pytest.mark.asyncio
async def test_impact_dashboard_customer(monkeypatch):
    from bson import ObjectId
    orders = [
        {
            "_id": ObjectId(OID),
            "customerId": ObjectId(OID2),
            "farmerId": ObjectId(OID),
            "totalAmount": 500,
            "deliveryType": "delivery",
            "orderStatus": "delivered",
            "items": [{"quantity": 5, "unit": "kg"}],
        },
        {
            "_id": ObjectId(OID2),
            "customerId": ObjectId(OID2),
            "farmerId": ObjectId(OID),
            "totalAmount": 300,
            "deliveryType": "pickup",
            "orderStatus": "picked_up",
            "items": [{"quantity": 2, "unit": "kg"}],
        },
    ]

    monkeypatch.setattr(impact_mod.order_repository, "find_many", AsyncMock(return_value=orders))

    result = await impact_mod.get_my_impact(_customer_user())
    data = result["data"]
    assert data["orders"] == 2
    assert data["totalSpent"] == 800
    assert data["farmersSupported"] == 1
    assert data["localDeliveries"] == 1
    assert data["pickupOrders"] == 1
    assert data["deliveredKg"] == 7


@pytest.mark.asyncio
async def test_invoice_requires_access(monkeypatch):
    monkeypatch.setattr(impact_mod.order_repository, "get_by_id", AsyncMock(return_value=None))
    with pytest.raises(Exception):
        await impact_mod.get_order_invoice(OID, _customer_user())


# ============ Feature D: Loyalty / AgriPoints ============

@pytest.mark.asyncio
async def test_award_points_for_delivered_order(monkeypatch):
    from bson import ObjectId
    order = {
        "_id": ObjectId(OID),
        "customerId": ObjectId(OID2),
        "orderNumber": "AG20260001",
        "totalAmount": 500,
        "deliveryType": "delivery",
        "selfDelivery": True,
        "distanceKm": 5,
    }
    account = {"_id": ObjectId(OID), "balance": 0, "lifetimeEarned": 0}

    async def fake_find_one(f):
        if "orderId" in f:
            return None  # no prior earn txn
        return dict(account)

    monkeypatch.setattr(loyalty_mod.txn_repo, "find_one", fake_find_one)
    monkeypatch.setattr(loyalty_mod.account_repo, "find_one", AsyncMock(return_value=dict(account)))
    monkeypatch.setattr(loyalty_mod.account_repo, "update", AsyncMock(return_value=True))
    monkeypatch.setattr(loyalty_mod.txn_repo, "create", AsyncMock(return_value=OID))
    monkeypatch.setattr(loyalty_mod.NotificationService, "create_in_app_notification", _noop_notification)

    result = await loyalty_mod.award_points_for_delivered_order(order)
    # base 5 + 5 (₹500*0.01) + pickup(0) + nearby(5) = 15
    assert result["points"] == 15


@pytest.mark.asyncio
async def test_redeem_requires_multiple(monkeypatch):
    account = {"_id": OID, "balance": 500, "lifetimeEarned": 500}

    monkeypatch.setattr(loyalty_mod.account_repo, "find_one", AsyncMock(return_value=dict(account)))

    from app.api.v1.loyalty import RedeemRequest
    with pytest.raises(Exception):
        await loyalty_mod.redeem_points(RedeemRequest(points=37), _customer_user())


# ============ Feature E: B2B marketplace ============

@pytest.mark.asyncio
async def test_business_creates_rfq(monkeypatch):
    created = {}

    async def fake_create(data):
        created.update(data)
        return OID

    async def fake_find_one(f):
        return dict(created)

    monkeypatch.setattr(b2b_mod.rfq_repo, "create", fake_create)
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_one", fake_find_one)
    monkeypatch.setattr(b2b_mod.profile_repo, "find_one", AsyncMock(return_value={"_id": OID}))

    from app.api.v1.b2b import RFQCreate
    data = RFQCreate(productName="Tomato", quantityPerWeekKg=100)
    result = await b2b_mod.create_rfq(data, _business_user())
    assert result["success"] is True
    assert result["data"]["status"] == "open"


@pytest.mark.asyncio
async def test_farmer_cannot_create_rfq(monkeypatch):
    from app.api.v1.b2b import RFQCreate
    with pytest.raises(Exception):
        await b2b_mod.create_rfq(RFQCreate(productName="Tomato", quantityPerWeekKg=100), _farmer_user())


@pytest.mark.asyncio
async def test_accept_offer_creates_order(monkeypatch):
    from bson import ObjectId
    offer = {"_id": ObjectId(OID), "rfqId": ObjectId(OID2), "businessUserId": ObjectId(OID3), "farmerId": ObjectId(OID), "productName": "Tomato", "pricePerKg": 38, "status": "pending"}
    rfq = {"_id": ObjectId(OID2), "businessUserId": ObjectId(OID3), "productName": "Tomato", "quantityPerWeekKg": 100, "recurring": True, "status": "open"}

    monkeypatch.setattr(b2b_mod.offer_repo, "find_one", AsyncMock(return_value=dict(offer)))
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_one", AsyncMock(return_value=dict(rfq)))
    monkeypatch.setattr(b2b_mod.offer_repo, "update", AsyncMock(return_value=True))
    b2b_mod.offer_repo._collection = AsyncMock()
    monkeypatch.setattr(b2b_mod.rfq_repo, "update", AsyncMock(return_value=True))
    monkeypatch.setattr(b2b_mod.order_repo, "create", AsyncMock(return_value=OID))
    monkeypatch.setattr(b2b_mod.NotificationService, "create_in_app_notification", _noop_notification)

    result = await b2b_mod.accept_offer(OID, data=None, current_user=_business_user())
    assert result["success"] is True
    assert result["data"]["order"]["pricePerKg"] == 38


@pytest.mark.asyncio
async def test_ai_rank_scores_offers(monkeypatch):
    from bson import ObjectId
    rfq = {"_id": ObjectId(OID2), "businessUserId": ObjectId(OID3), "productName": "Tomato",
           "quantityKg": 500, "recurring": False, "status": "open", "qualityGrade": "Grade A",
           "deliveryLocation": None, "deliveryCity": "Coimbatore", "deliveryState": "Tamil Nadu"}
    offers = [
        {"_id": ObjectId(OID), "rfqId": ObjectId(OID2), "businessUserId": ObjectId(OID3),
         "farmerId": ObjectId(OID), "productName": "Tomato", "pricePerKg": 38,
         "availableQuantityKg": 500, "status": "pending", "deliveryMethod": "farmer_delivery"},
        {"_id": ObjectId(OID2), "rfqId": ObjectId(OID2), "businessUserId": ObjectId(OID3),
         "farmerId": ObjectId(OID2), "productName": "Tomato", "pricePerKg": 37,
         "availableQuantityKg": 300, "status": "pending", "deliveryMethod": "farmer_delivery"},
    ]
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_one", AsyncMock(return_value=dict(rfq)))
    monkeypatch.setattr(b2b_mod.offer_repo, "find_many", AsyncMock(return_value=offers))
    monkeypatch.setattr(b2b_mod.farmer_repository, "find_one",
                        AsyncMock(return_value={"userId": OID, "farmName": "Kumar Farms", "rating": 4.8, "isVerified": True}))
    monkeypatch.setattr(b2b_mod, "_distance_km", lambda *a, **k: 12.0)

    result = await b2b_mod.ai_rank_rfq_offers(OID2, current_user=_business_user())
    assert result["success"] is True
    scores = result["data"]["scores"]
    assert len(scores) == 2
    assert scores[0]["farmName"] == "Kumar Farms"
    assert scores[0]["aiScore"] > scores[1]["aiScore"]
    assert result["data"]["best"]["offerId"] == scores[0]["offerId"]
    assert "recommendedOfferIds" in result["data"]


@pytest.mark.asyncio
async def test_ai_split_procurement_across_farmers(monkeypatch):
    from bson import ObjectId
    rfq = {"_id": ObjectId(OID2), "businessUserId": ObjectId(OID3), "productName": "Tomato",
           "quantityKg": 500, "recurring": False, "status": "open", "acceptedQuantityKg": 0,
           "deliveryLocation": None, "deliveryCity": "Coimbatore"}
    offers = [
        {"_id": ObjectId(OID), "rfqId": ObjectId(OID2), "businessUserId": ObjectId(OID3),
         "farmerId": ObjectId(OID), "productName": "Tomato", "pricePerKg": 38,
         "availableQuantityKg": 200, "status": "pending", "deliveryMethod": "farmer_delivery"},
        {"_id": ObjectId(OID2), "rfqId": ObjectId(OID2), "businessUserId": ObjectId(OID3),
         "farmerId": ObjectId(OID2), "productName": "Tomato", "pricePerKg": 39,
         "availableQuantityKg": 150, "status": "pending", "deliveryMethod": "farmer_delivery"},
        {"_id": ObjectId(OID3), "rfqId": ObjectId(OID2), "businessUserId": ObjectId(OID3),
         "farmerId": ObjectId(OID3), "productName": "Tomato", "pricePerKg": 37,
         "availableQuantityKg": 150, "status": "pending", "deliveryMethod": "farmer_delivery"},
    ]
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_one", AsyncMock(return_value=dict(rfq)))
    monkeypatch.setattr(b2b_mod.offer_repo, "find_many", AsyncMock(return_value=offers))
    monkeypatch.setattr(b2b_mod.farmer_repository, "find_one",
                        AsyncMock(return_value={"userId": OID, "farmName": "Kumar Farms", "rating": 4.8, "isVerified": True}))
    monkeypatch.setattr(b2b_mod, "_distance_km", lambda *a, **k: 10.0)

    result = await b2b_mod.ai_split_procurement(OID2, current_user=_business_user())
    assert result["success"] is True
    data = result["data"]
    assert data["possible"] is True
    assert data["totalQuantityKg"] == 500
    assert len(data["rows"]) == 3
    assert sum(r["quantityKg"] for r in data["rows"]) == 500
    assert data["estimatedTotal"] > 0


# ============ AI price recommendation ============

@pytest.mark.asyncio
async def test_ai_price_recommendation_from_quotes(monkeypatch):
    from bson import ObjectId
    offers = [
        {"_id": ObjectId(OID), "rfqId": ObjectId(OID2), "productName": "Fresh Tomatoes",
         "pricePerKg": 30, "createdAt": datetime.utcnow() - timedelta(days=5)},
        {"_id": ObjectId(OID2), "rfqId": ObjectId(OID2), "productName": "tomato",
         "pricePerKg": 40, "createdAt": datetime.utcnow() - timedelta(days=2)},
        {"_id": ObjectId(OID3), "rfqId": ObjectId(OID2), "productName": "Tomatoes",
         "pricePerKg": 35, "createdAt": datetime.utcnow() - timedelta(days=1)},
    ]
    rfqs = [
        {"_id": ObjectId(OID2), "deliveryCity": "Coimbatore", "deliveryState": "Tamil Nadu"},
    ]
    monkeypatch.setattr(b2b_mod.order_repo, "find_many", AsyncMock(return_value=[]))
    monkeypatch.setattr(b2b_mod.offer_repo, "find_many", AsyncMock(return_value=offers))
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_many", AsyncMock(return_value=rfqs))
    monkeypatch.setattr(b2b_mod.product_repository, "find_many", AsyncMock(return_value=[]))

    from app.api.v1.b2b import PriceRecommendationRequest
    result = await b2b_mod.price_recommendation(
        PriceRecommendationRequest(productName="tomatoes", city="Coimbatore"), _business_user()
    )
    assert result["success"] is True
    data = result["data"]
    assert data["source"] == "quotes"
    assert data["count"] == 3
    assert data["minPerKg"] == 30
    assert data["maxPerKg"] == 40
    assert data["medianPerKg"] == 35
    assert data["cityMatched"] is True
    assert data["recommendedMin"] <= data["recommendedMax"]
    assert data["suggestedPricePerKg"] is not None


@pytest.mark.asyncio
async def test_ai_price_recommendation_marketplace_fallback(monkeypatch):
    monkeypatch.setattr(b2b_mod.order_repo, "find_many", AsyncMock(return_value=[]))
    monkeypatch.setattr(b2b_mod.offer_repo, "find_many", AsyncMock(return_value=[]))
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_many", AsyncMock(return_value=[]))
    products = [
        {"name": "Tomato", "bulkPrice": 32, "isActive": True},
        {"name": "Tomatoes", "price": 38, "isActive": True},
    ]
    monkeypatch.setattr(b2b_mod.product_repository, "find_many", AsyncMock(return_value=products))

    from app.api.v1.b2b import PriceRecommendationRequest
    result = await b2b_mod.price_recommendation(
        PriceRecommendationRequest(productName="tomato"), _business_user()
    )
    assert result["success"] is True
    data = result["data"]
    assert data["source"] == "marketplace"
    assert data["count"] == 2
    assert data["minPerKg"] == 32
    assert data["maxPerKg"] == 38


@pytest.mark.asyncio
async def test_ai_price_recommendation_no_data(monkeypatch):
    monkeypatch.setattr(b2b_mod.order_repo, "find_many", AsyncMock(return_value=[]))
    monkeypatch.setattr(b2b_mod.offer_repo, "find_many", AsyncMock(return_value=[]))
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_many", AsyncMock(return_value=[]))
    monkeypatch.setattr(b2b_mod.product_repository, "find_many", AsyncMock(return_value=[]))

    from app.api.v1.b2b import PriceRecommendationRequest
    result = await b2b_mod.price_recommendation(
        PriceRecommendationRequest(productName="kiwi"), _business_user()
    )
    assert result["success"] is True
    data = result["data"]
    assert data["source"] == "none"
    assert data["count"] == 0
    assert data["recommendedMin"] is None
    assert data["confidenceScore"] == 0


@pytest.mark.asyncio
async def test_ai_price_engine_orders_dominate_quotes(monkeypatch):
    from bson import ObjectId
    orders = [
        {"_id": ObjectId(OID), "productName": "Tomato", "pricePerKg": 30, "quantityKg": 500,
         "qualityGrade": "Grade A", "startedAt": datetime.utcnow() - timedelta(days=1)},
        {"_id": ObjectId(OID2), "productName": "Tomato", "pricePerKg": 32, "quantityKg": 300,
         "qualityGrade": "Grade A", "startedAt": datetime.utcnow() - timedelta(days=2)},
    ]
    offers = [
        {"_id": ObjectId(OID3), "rfqId": ObjectId(OID2), "productName": "Tomato",
         "pricePerKg": 45, "createdAt": datetime.utcnow() - timedelta(days=1)},
    ]
    rfqs = [{"_id": ObjectId(OID2), "deliveryCity": "Coimbatore"}]
    monkeypatch.setattr(b2b_mod.order_repo, "find_many", AsyncMock(return_value=orders))
    monkeypatch.setattr(b2b_mod.offer_repo, "find_many", AsyncMock(return_value=offers))
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_many", AsyncMock(return_value=rfqs))
    monkeypatch.setattr(b2b_mod.product_repository, "find_many", AsyncMock(return_value=[]))

    from app.api.v1.b2b import PriceRecommendationRequest
    result = await b2b_mod.price_recommendation(
        PriceRecommendationRequest(productName="tomato", qualityGrade="Grade A"), _business_user()
    )
    data = result["data"]
    assert data["source"] == "blended"
    assert data["sourcesUsed"]["orders"] == 2
    # Quantity-weighted settled orders pull the median down to ~₹30, not the ₹45 quote.
    assert data["medianPerKg"] == 30
    assert data["recommendedMax"] <= 33
    assert data["confidence"] == "low"


@pytest.mark.asyncio
async def test_ai_price_engine_quality_adjustment(monkeypatch):
    from bson import ObjectId
    orders = [
        {"_id": ObjectId(OID), "productName": "Tomato", "pricePerKg": 27, "quantityKg": 100,
         "qualityGrade": "Grade C", "startedAt": datetime.utcnow() - timedelta(days=1)},
    ]
    offers = [
        {"_id": ObjectId(OID2), "rfqId": ObjectId(OID2), "productName": "Tomato",
         "pricePerKg": 40, "createdAt": datetime.utcnow() - timedelta(days=1)},
    ]
    rfqs = [{"_id": ObjectId(OID2), "qualityGrade": "Grade A", "deliveryCity": "Coimbatore"}]
    monkeypatch.setattr(b2b_mod.order_repo, "find_many", AsyncMock(return_value=orders))
    monkeypatch.setattr(b2b_mod.offer_repo, "find_many", AsyncMock(return_value=offers))
    monkeypatch.setattr(b2b_mod.rfq_repo, "find_many", AsyncMock(return_value=rfqs))
    monkeypatch.setattr(b2b_mod.product_repository, "find_many", AsyncMock(return_value=[]))

    from app.api.v1.b2b import PriceRecommendationRequest
    # Grade C @ ₹27 normalises to ~₹31.76 for a Grade A request (27 / 0.85).
    result = await b2b_mod.price_recommendation(
        PriceRecommendationRequest(productName="tomato", qualityGrade="Grade A"), _business_user()
    )
    data = result["data"]
    assert data["medianPerKg"] == 31.76
    assert data["minPerKg"] == 31.76


# ============ AI demand forecast (business buyer) ============

@pytest.mark.asyncio
async def test_ai_demand_forecast(monkeypatch):
    from bson import ObjectId
    orders = [
        {"_id": ObjectId(OID), "businessUserId": ObjectId(OID3), "productName": "Tomato",
         "quantityKg": 120, "startedAt": datetime.utcnow() - timedelta(days=1)},
        {"_id": ObjectId(OID2), "businessUserId": ObjectId(OID3), "productName": "Tomato",
         "quantityKg": 80, "startedAt": datetime.utcnow() - timedelta(days=3)},
        {"_id": ObjectId(OID3), "businessUserId": ObjectId(OID3), "productName": "Onion",
         "quantityKg": 30, "startedAt": datetime.utcnow() - timedelta(days=2)},
    ]
    monkeypatch.setattr(b2b_mod.order_repo, "find_many", AsyncMock(return_value=orders))

    result = await b2b_mod.demand_forecast(_business_user())
    assert result["success"] is True
    items = result["data"]["items"]
    assert len(items) == 2
    tomato = next(i for i in items if i["productName"] == "Tomato")
    assert tomato["expectedKgPerWeek"] > 0
    assert tomato["level"] == "HIGH"
    assert "recommendation" in tomato


@pytest.mark.asyncio
async def test_ai_demand_forecast_requires_business(monkeypatch):
    with pytest.raises(Exception):
        await b2b_mod.demand_forecast(_farmer_user())


# ============ Feature F: Batch / lot management + traceability ============

@pytest.mark.asyncio
async def test_farmer_creates_batch_with_lot_number(monkeypatch):
    created = {}

    async def fake_create(data):
        created.update(data)
        return OID

    async def fake_lot():
        return "LOT-20260817-001"

    monkeypatch.setattr(batches_mod.batch_repo, "create", fake_create)
    monkeypatch.setattr(batches_mod, "_next_lot_number", fake_lot)

    from app.api.v1.batches import BatchCreate
    result = await batches_mod.create_batch(
        BatchCreate(cropName="Tomato", quantityKg=500, qualityGrade="Premium", storageType="refrigerated"),
        _farmer_user(),
    )
    assert result["success"] is True
    data = result["data"]
    assert data["lotNumber"] == "LOT-20260817-001"
    assert data["quantityKg"] == 500.0
    assert data["remainingKg"] == 500.0
    assert data["shelfLifeDays"] == 5  # refrigerated default
    assert data["status"] == "created"
    assert data["freshness"]["status"] in ("fresh", "expiring")


@pytest.mark.asyncio
async def test_non_farmer_cannot_create_batch(monkeypatch):
    from app.api.v1.batches import BatchCreate
    with pytest.raises(Exception):
        await batches_mod.create_batch(
            BatchCreate(cropName="Tomato", quantityKg=10),
            _customer_user(),
        )


@pytest.mark.asyncio
async def test_convert_batch_adds_product_stock(monkeypatch):
    from bson import ObjectId
    batch = {
        "_id": ObjectId(OID),
        "farmerId": ObjectId(OID),
        "lotNumber": "LOT-20260817-001",
        "cropName": "Tomato",
        "quantityKg": 500.0,
        "remainingKg": 500.0,
        "harvestDate": datetime.utcnow() - timedelta(days=1),
        "shelfLifeDays": 3,
        "expiresAt": datetime.utcnow() + timedelta(days=2),
        "status": "created",
    }
    product = {"_id": ObjectId(OID2), "farmerId": ObjectId(OID), "name": "Tomato", "quantity": 100, "unit": "kg"}
    product_updated = {}
    batch_updated = {}

    fake_update_product = AsyncMock(side_effect=lambda pid, d: product_updated.update({"pid": pid, **d}) or True)
    fake_update_batch = AsyncMock(side_effect=lambda f, d: batch_updated.update(d) or True)
    monkeypatch.setattr(batches_mod.batch_repo, "find_one", AsyncMock(return_value=batch))
    monkeypatch.setattr(batches_mod.product_repository, "get_by_id", AsyncMock(return_value=product))
    monkeypatch.setattr(batches_mod.product_repository, "update_product", fake_update_product)
    monkeypatch.setattr(batches_mod.batch_repo, "update", fake_update_batch)

    result = await batches_mod.convert_batch_to_inventory(OID, {"productId": OID2}, _farmer_user())
    assert result["success"] is True
    assert product_updated["pid"] == OID2
    assert product_updated["quantity"] == 600  # 100 + 500
    assert batch_updated["status"] == "listed"
    assert batch_updated["remainingKg"] == 0.0


@pytest.mark.asyncio
async def test_trace_batch_not_found(monkeypatch):
    monkeypatch.setattr(batches_mod.batch_repo, "find_one", AsyncMock(return_value=None))
    with pytest.raises(Exception):
        await batches_mod.trace_batch("LOT-NOPE")


@pytest.mark.asyncio
async def test_trace_batch_returns_farm_context(monkeypatch):
    from bson import ObjectId
    batch = {
        "_id": ObjectId(OID),
        "farmerId": ObjectId(OID),
        "lotNumber": "LOT-20260817-001",
        "cropName": "Tomato",
        "quantityKg": 500.0,
        "harvestDate": datetime.utcnow() - timedelta(days=1),
        "qualityGrade": "Premium",
        "storageType": "normal",
        "shelfLifeDays": 3,
        "expiresAt": datetime.utcnow() + timedelta(days=2),
        "status": "listed",
        "productId": ObjectId(OID2),
    }
    product = {"_id": ObjectId(OID2), "name": "Tomato", "price": 40, "unit": "kg"}
    monkeypatch.setattr(batches_mod.batch_repo, "find_one", AsyncMock(return_value=batch))
    monkeypatch.setattr(batches_mod.user_repository, "get_by_id", AsyncMock(return_value={"firstName": "Kumar", "lastName": "Rao"}))
    monkeypatch.setattr(batches_mod.farmer_repository, "find_one", AsyncMock(return_value={"farmName": "Green Farm", "village": "Madapur", "state": "KA"}))
    monkeypatch.setattr(batches_mod.product_repository, "get_by_id", AsyncMock(return_value=product))

    result = await batches_mod.trace_batch("LOT-20260817-001")
    data = result["data"]
    assert data["lotNumber"] == "LOT-20260817-001"
    assert data["listed"] is True
    assert data["farmer"]["farmerName"] == "Kumar Rao"
    assert data["farmer"]["farmName"] == "Green Farm"
    assert data["product"]["price"] == 40
