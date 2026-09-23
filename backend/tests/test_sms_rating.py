import pytest
from bson import ObjectId

from app.services import sms_rating_service as module
from app.services.sms_rating_service import SMSRatingService

CUSTOMER_ID = "666666666666666666666666"
PRODUCT_ID = "111111111111111111111111"
ORDER_ID = "333333333333333333333333"
PARTNER_ID = "222222222222222222222222"
TOKEN = "abc123token"


def make_order(**overrides):
    order = {
        "_id": ObjectId(ORDER_ID),
        "customerId": ObjectId(CUSTOMER_ID),
        "orderStatus": "delivered",
        "deliveryPartnerId": ObjectId(PARTNER_ID),
        "orderNumber": "ORD-2001",
        "items": [{"productId": ObjectId(PRODUCT_ID), "quantity": 2}],
        "smsRating": {
            "active": True,
            "ratingToken": TOKEN,
            "pending": [PRODUCT_ID],
            "total": 1,
            "deliveryPartner": {"id": PARTNER_ID, "name": "Ravi Sharma"},
            "deliveryDone": False,
        },
    }
    order.update(overrides)
    return order


class DummyOrderRepository:
    def __init__(self, order):
        self.order = order
        self.cleared = []
        self.updated = []

    async def get_by_rating_token(self, token):
        return self.order if token == TOKEN else None

    async def clear_rating_session(self, order_id):
        self.cleared.append(order_id)
        return True

    async def update_rating_session(self, order_id, updates):
        self.updated.append((order_id, updates))
        return True


@pytest.fixture
def deps(monkeypatch):
    order = make_order()
    dummy = DummyOrderRepository(order)

    async def fake_create_review(*args, **kwargs):
        return {"_id": "review1"}

    async def fake_submit_delivery(*args, **kwargs):
        return True

    monkeypatch.setattr(module, "order_repository", dummy)
    monkeypatch.setattr(module.ProductService, "create_review", fake_create_review)
    monkeypatch.setattr(SMSRatingService, "_submit_delivery_rating", fake_submit_delivery)

    return {"order_repo": dummy, "order": order}


@pytest.mark.asyncio
async def test_submit_products_and_delivery_completes_session(deps):
    result = await SMSRatingService.submit_ratings(
        TOKEN,
        {PRODUCT_ID: 5},
        delivery_rating={"overallRating": 4, "feedback": "Great"},
    )

    assert result["success"] is True
    assert result["created"] == 1
    assert result["deliveryRated"] is True
    assert result["done"] is True
    # Fully rated -> session cleared, no partial update.
    assert deps["order_repo"].cleared == [ORDER_ID]
    assert deps["order_repo"].updated == []


@pytest.mark.asyncio
async def test_submit_products_only_keeps_session_for_delivery(deps):
    result = await SMSRatingService.submit_ratings(TOKEN, {PRODUCT_ID: 5})

    assert result["success"] is True
    assert result["created"] == 1
    assert result["deliveryRated"] is False
    assert result["done"] is False
    # Products done but delivery pending -> session stays active.
    assert deps["order_repo"].cleared == []
    assert deps["order_repo"].updated == [(ORDER_ID, {"pending": [], "deliveryDone": False})]


@pytest.mark.asyncio
async def test_submit_delivery_only_completes_session(deps):
    deps["order"]["smsRating"]["pending"] = []

    result = await SMSRatingService.submit_ratings(
        TOKEN,
        {},
        delivery_rating={"overallRating": 3, "feedback": "Okay"},
    )

    assert result["success"] is True
    assert result["created"] == 0
    assert result["deliveryRated"] is True
    assert result["done"] is True
    assert deps["order_repo"].cleared == [ORDER_ID]


@pytest.mark.asyncio
async def test_submit_nothing_keeps_session_active(deps):
    result = await SMSRatingService.submit_ratings(TOKEN, {})

    assert result["success"] is False
    assert deps["order_repo"].cleared == []
    assert deps["order_repo"].updated == []


@pytest.mark.asyncio
async def test_invalid_token_rejected(deps):
    result = await SMSRatingService.submit_ratings("bad-token", {PRODUCT_ID: 5})
    assert result["success"] is False
    assert result["message"] == "invalid link"
