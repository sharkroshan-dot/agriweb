import asyncio

import pytest
from bson import ObjectId
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from app.api.v1.auth import get_current_user
from app.api.v1.delivery_ratings import router as delivery_ratings_router
from app.repositories.delivery_rating_repository import DeliveryRatingRepository
from app.schemas.delivery_rating import DeliveryRatingCreate
from app.services import delivery_rating_service as rating_module
from app.services.delivery_rating_service import delivery_rating_service

CUSTOMER_ID = "666666666666666666666666"
OTHER_CUSTOMER_ID = "777777777777777777777777"
PARTNER_PROFILE_ID = "222222222222222222222222"
PARTNER_USER_ID = "111111111111111111111111"
ORDER_ID = "333333333333333333333333"
RATING_ID = "555555555555555555555555"


def make_order(**overrides):
    order = {
        "_id": ObjectId(ORDER_ID),
        "customerId": ObjectId(CUSTOMER_ID),
        "orderStatus": "delivered",
        "deliveryPartnerId": ObjectId(PARTNER_PROFILE_ID),
        "orderNumber": "ORD-1001",
    }
    order.update(overrides)
    return order


def make_rating(**overrides):
    rating = {
        "_id": ObjectId(RATING_ID),
        "deliveryPartnerId": ObjectId(PARTNER_PROFILE_ID),
        "orderId": ObjectId(ORDER_ID),
        "customerId": ObjectId(CUSTOMER_ID),
        "orderNumber": "ORD-1001",
        "overallRating": 5,
        "onTimeRating": 4,
        "professionalismRating": 5,
        "handlingRating": 4,
        "communicationRating": 5,
        "feedback": "Great delivery",
        "createdAt": None,
    }
    rating.update(overrides)
    return rating


class DummyRatingRepository:
    """In-memory stand-in for delivery_rating_repository."""

    def __init__(self):
        self.ratings = {}

    async def get_by_order(self, order_id):
        for r in self.ratings.values():
            if str(r["orderId"]) == str(order_id):
                return r
        return None

    async def get_by_customer(self, customer_id, skip=0, limit=20):
        return [
            r for r in self.ratings.values()
            if str(r["customerId"]) == str(customer_id)
        ][skip:skip + limit]

    async def count_by_customer(self, customer_id):
        return len([
            r for r in self.ratings.values()
            if str(r["customerId"]) == str(customer_id)
        ])

    async def get_by_partner(self, partner_id, skip=0, limit=20):
        return [
            r for r in self.ratings.values()
            if str(r["deliveryPartnerId"]) == str(partner_id)
        ][skip:skip + limit]

    async def count_by_partner(self, partner_id):
        return len([
            r for r in self.ratings.values()
            if str(r["deliveryPartnerId"]) == str(partner_id)
        ])

    async def get_summary(self, partner_id):
        ratings = [
            r for r in self.ratings.values()
            if str(r["deliveryPartnerId"]) == str(partner_id)
        ]
        if not ratings:
            return {"count": 0}
        return {"count": len(ratings)}

    async def get_all(self, skip=0, limit=20, partner_id=None, customer_id=None):
        items = list(self.ratings.values())
        if partner_id:
            items = [r for r in items if str(r["deliveryPartnerId"]) == str(partner_id)]
        if customer_id:
            items = [r for r in items if str(r["customerId"]) == str(customer_id)]
        return items[skip:skip + limit]

    async def count_all(self, partner_id=None, customer_id=None):
        items = await self.get_all(limit=10_000, partner_id=partner_id, customer_id=customer_id)
        return len(items)

    async def get_by_id(self, rating_id):
        return self.ratings.get(str(rating_id))

    async def hard_delete(self, rating_id):
        if str(rating_id) in self.ratings:
            del self.ratings[str(rating_id)]
            return True
        return False

    async def create(self, data):
        data["_id"] = RATING_ID
        data["createdAt"] = data.get("createdAt")
        self.ratings[RATING_ID] = data
        return RATING_ID


class DummyOrderRepository:
    def __init__(self):
        self.orders = {}

    async def get_by_id(self, order_id):
        return self.orders.get(str(order_id))


class DummyDeliveryRepository:
    def __init__(self):
        self.profiles = {}
        self.rating_refreshes = []

    async def get_by_user_id(self, user_id):
        for profile in self.profiles.values():
            if str(profile.get("userId")) == str(user_id):
                return profile
        return None

    async def get_by_id(self, partner_id):
        return self.profiles.get(str(partner_id))

    async def refresh_rating_stats(self, partner_id):
        self.rating_refreshes.append(str(partner_id))
        return {"rating": 4.5, "ratingCount": 1}


class DummyUserRepository:
    def __init__(self):
        self.users = {}

    async def get_by_id(self, user_id):
        return self.users.get(str(user_id))


@pytest.fixture(autouse=True)
def rating_deps(monkeypatch):
    """Wire in-memory repositories into the rating service and its helpers."""
    dummy_rating = DummyRatingRepository()
    dummy_order = DummyOrderRepository()
    dummy_delivery = DummyDeliveryRepository()
    dummy_user = DummyUserRepository()

    monkeypatch.setattr(rating_module, "delivery_rating_repository", dummy_rating)
    monkeypatch.setattr(rating_module, "order_repository", dummy_order)
    monkeypatch.setattr(rating_module, "delivery_repository", dummy_delivery)

    import app.api.v1.delivery_ratings as ratings_api
    monkeypatch.setattr(ratings_api, "delivery_repository", dummy_delivery)

    # The repositories package __init__ shadows submodules with the singleton
    # attribute, so import the modules explicitly via importlib.
    import importlib
    delivery_repo_module = importlib.import_module("app.repositories.delivery_repository")
    monkeypatch.setattr(delivery_repo_module, "delivery_repository", dummy_delivery)

    user_repo_module = importlib.import_module("app.repositories.user_repository")
    monkeypatch.setattr(user_repo_module, "user_repository", dummy_user)

    # Seed a delivery partner profile (user id -> profile id).
    dummy_delivery.profiles[PARTNER_PROFILE_ID] = {
        "_id": PARTNER_PROFILE_ID,
        "userId": ObjectId(PARTNER_USER_ID),
    }
    dummy_user.users[CUSTOMER_ID] = {
        "_id": CUSTOMER_ID,
        "firstName": "Aisha",
        "lastName": "Khan",
    }
    dummy_user.users[PARTNER_USER_ID] = {
        "_id": PARTNER_USER_ID,
        "firstName": "Ravi",
        "lastName": "Sharma",
    }

    # Mirror main.py's global ObjectId JSON encoder so response bodies
    # containing ObjectId fields serialize correctly.
    import fastapi.encoders as fastapi_encoders
    import fastapi.routing as fastapi_routing
    original_encoder = fastapi_encoders.jsonable_encoder

    def _objectid_safe_encoder(obj, *args, **kwargs):
        if isinstance(obj, ObjectId):
            return str(obj)
        return original_encoder(obj, *args, **kwargs)

    monkeypatch.setattr(fastapi_encoders, "jsonable_encoder", _objectid_safe_encoder)
    monkeypatch.setattr(fastapi_routing, "jsonable_encoder", _objectid_safe_encoder)

    return {
        "rating": dummy_rating,
        "order": dummy_order,
        "delivery": dummy_delivery,
        "user": dummy_user,
    }


# --------------------------------------------------------------------------
# Service: submit_rating validation
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_submit_rating_order_not_found(rating_deps):
    with pytest.raises(HTTPException) as exc:
        await delivery_rating_service.submit_rating(
            CUSTOMER_ID, ORDER_ID, DeliveryRatingCreate(
                orderId=ORDER_ID,
                overallRating=5, onTimeRating=4,
                professionalismRating=5, handlingRating=4, communicationRating=5,
            )
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_submit_rating_not_owner_forbidden(rating_deps):
    rating_deps["order"].orders[ORDER_ID] = make_order(customerId=ObjectId(OTHER_CUSTOMER_ID))
    with pytest.raises(HTTPException) as exc:
        await delivery_rating_service.submit_rating(
            CUSTOMER_ID, ORDER_ID, DeliveryRatingCreate(
                orderId=ORDER_ID,
                overallRating=5, onTimeRating=5,
                professionalismRating=5, handlingRating=5, communicationRating=5,
            )
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_submit_rating_only_after_delivered(rating_deps):
    rating_deps["order"].orders[ORDER_ID] = make_order(orderStatus="confirmed")
    with pytest.raises(HTTPException) as exc:
        await delivery_rating_service.submit_rating(
            CUSTOMER_ID, ORDER_ID, DeliveryRatingCreate(
                orderId=ORDER_ID,
                overallRating=5, onTimeRating=5,
                professionalismRating=5, handlingRating=5, communicationRating=5,
            )
        )
    assert exc.value.status_code == 400
    assert "delivered" in exc.value.detail


@pytest.mark.asyncio
async def test_submit_rating_requires_assigned_partner(rating_deps):
    rating_deps["order"].orders[ORDER_ID] = make_order(deliveryPartnerId=None)
    with pytest.raises(HTTPException) as exc:
        await delivery_rating_service.submit_rating(
            CUSTOMER_ID, ORDER_ID, DeliveryRatingCreate(
                orderId=ORDER_ID,
                overallRating=5, onTimeRating=5,
                professionalismRating=5, handlingRating=5, communicationRating=5,
            )
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_submit_rating_duplicate_conflict(rating_deps):
    rating_deps["order"].orders[ORDER_ID] = make_order()
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    with pytest.raises(HTTPException) as exc:
        await delivery_rating_service.submit_rating(
            CUSTOMER_ID, ORDER_ID, DeliveryRatingCreate(
                orderId=ORDER_ID,
                overallRating=4, onTimeRating=4,
                professionalismRating=4, handlingRating=4, communicationRating=4,
            )
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_submit_rating_success(rating_deps):
    rating_deps["order"].orders[ORDER_ID] = make_order()
    result = await delivery_rating_service.submit_rating(
        CUSTOMER_ID, ORDER_ID, DeliveryRatingCreate(
            orderId=ORDER_ID,
            overallRating=5, onTimeRating=4,
            professionalismRating=5, handlingRating=4, communicationRating=5,
            feedback="Fresh and on time",
        )
    )

    assert result["id"] == RATING_ID
    assert str(result["customerId"]) == CUSTOMER_ID
    assert str(result["deliveryPartnerId"]) == PARTNER_PROFILE_ID
    assert str(result["orderId"]) == ORDER_ID
    assert result["orderNumber"] == "ORD-1001"
    assert result["feedback"] == "Fresh and on time"

    stored = rating_deps["rating"].ratings[RATING_ID]
    assert stored["overallRating"] == 5
    assert stored["communicationRating"] == 5
    # Partner stats should be refreshed after a successful rating.
    assert rating_deps["delivery"].rating_refreshes == [PARTNER_PROFILE_ID]


@pytest.mark.asyncio
async def test_submit_rating_blank_feedback_stored_as_none(rating_deps):
    rating_deps["order"].orders[ORDER_ID] = make_order()
    result = await delivery_rating_service.submit_rating(
        CUSTOMER_ID, ORDER_ID, DeliveryRatingCreate(
            orderId=ORDER_ID,
            overallRating=3, onTimeRating=3,
            professionalismRating=3, handlingRating=3, communicationRating=3,
            feedback="   ",
        )
    )
    assert result["feedback"] is None


# --------------------------------------------------------------------------
# Service: partner / customer / admin views
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_partner_ratings_do_not_leak_customer_pii(rating_deps):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    # Extra fields a careless implementation might expose:
    rating_deps["rating"].ratings[RATING_ID]["customerName"] = "Aisha Khan"
    rating_deps["rating"].ratings[RATING_ID]["customerPhone"] = "9876543210"

    result = await delivery_rating_service.get_partner_ratings(PARTNER_PROFILE_ID)
    assert result["summary"]["count"] == 1
    assert result["pagination"]["total"] == 1
    item = result["ratings"][0]
    assert item["orderNumber"] == "ORD-1001"
    assert item["feedback"] == "Great delivery"
    # Privacy: no customer identifying fields may reach the partner.
    for key in ("customerId", "customerName", "customerPhone", "customerEmail", "address"):
        assert key not in item, f"partner rating leaked '{key}'"


@pytest.mark.asyncio
async def test_partner_summary(rating_deps):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    summary = await delivery_rating_service.get_partner_summary(PARTNER_PROFILE_ID)
    assert summary["count"] == 1


@pytest.mark.asyncio
async def test_customer_ratings(rating_deps):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    result = await delivery_rating_service.get_customer_ratings(CUSTOMER_ID)
    assert result["pagination"]["total"] == 1
    assert str(result["ratings"][0]["deliveryPartnerId"]) == PARTNER_PROFILE_ID


@pytest.mark.asyncio
async def test_admin_list_attaches_names(rating_deps):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    result = await delivery_rating_service.list_for_admin(page=1, limit=20)
    assert result["total"] == 1
    row = result["ratings"][0]
    assert row["deliveryPartnerName"] == "Ravi Sharma"
    assert row["customerName"] == "Aisha Khan"
    assert row["orderNumber"] == "ORD-1001"


@pytest.mark.asyncio
async def test_admin_list_filters_by_partner(rating_deps):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    result = await delivery_rating_service.list_for_admin(
        partner_id="999999999999999999999999", page=1, limit=20
    )
    assert result["total"] == 0
    assert result["ratings"] == []


@pytest.mark.asyncio
async def test_admin_delete_rating(rating_deps):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    result = await delivery_rating_service.delete_rating(RATING_ID)
    assert result["message"] == "Rating deleted"
    assert RATING_ID not in rating_deps["rating"].ratings
    assert rating_deps["delivery"].rating_refreshes == [PARTNER_PROFILE_ID]


@pytest.mark.asyncio
async def test_admin_delete_rating_not_found(rating_deps):
    with pytest.raises(HTTPException) as exc:
        await delivery_rating_service.delete_rating("999999999999999999999999")
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------
# Repository: aggregation
# --------------------------------------------------------------------------

def test_get_summary_computes_stats(monkeypatch):
    repo = DeliveryRatingRepository()

    async def fake_aggregate(pipeline):
        return [{
            "count": 4,
            "overallAvg": 4.5,
            "onTimeAvg": 3.75,
            "professionalismAvg": 4.0,
            "handlingAvg": 4.25,
            "communicationAvg": 4.5,
            "positiveOnTime": 3,
        }]

    async def fake_distribution(partner_id):
        return {"1": 0, "2": 0, "3": 1, "4": 1, "5": 2}

    monkeypatch.setattr(repo, "aggregate", fake_aggregate)
    monkeypatch.setattr(repo, "get_distribution", fake_distribution)

    result = asyncio.run(repo.get_summary(PARTNER_PROFILE_ID))
    assert result["count"] == 4
    assert result["overallAvg"] == 4.5
    assert result["onTimeAvg"] == 3.75
    assert result["onTimePercentage"] == 75.0
    assert result["distribution"]["5"] == 2


def test_get_summary_empty(monkeypatch):
    repo = DeliveryRatingRepository()

    async def fake_aggregate(pipeline):
        return []

    monkeypatch.setattr(repo, "aggregate", fake_aggregate)

    result = asyncio.run(repo.get_summary(PARTNER_PROFILE_ID))
    assert result["count"] == 0
    assert result["onTimePercentage"] == 0
    assert all(v == 0 for v in result["distribution"].values())


def test_get_distribution_parses_star_counts(monkeypatch):
    repo = DeliveryRatingRepository()

    async def fake_aggregate(pipeline):
        return [{"_id": 5, "count": 2}, {"_id": 3, "count": 1}, {"_id": "bad", "count": 9}]

    monkeypatch.setattr(repo, "aggregate", fake_aggregate)

    result = asyncio.run(repo.get_distribution(PARTNER_PROFILE_ID))
    assert result["5"] == 2
    assert result["3"] == 1
    # Invalid star values are ignored; missing levels default to zero.
    assert result["1"] == 0
    assert result["2"] == 0
    assert result["4"] == 0


# --------------------------------------------------------------------------
# API routes
# --------------------------------------------------------------------------

API_PREFIX = "/delivery-ratings"


def make_app(user):
    app = FastAPI()
    # A non-empty prefix is required: the router defines an empty-path route.
    app.include_router(delivery_ratings_router, prefix=API_PREFIX)

    async def override():
        return user

    app.dependency_overrides[get_current_user] = override
    return app


@pytest.fixture
def customer_user():
    return {"_id": ObjectId(CUSTOMER_ID), "role": "customer"}


@pytest.mark.asyncio
async def test_api_submit_rating_as_customer(rating_deps, customer_user):
    rating_deps["order"].orders[ORDER_ID] = make_order()
    app = make_app(customer_user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/delivery-ratings", json={
            "orderId": ORDER_ID,
            "overallRating": 5,
            "onTimeRating": 4,
            "professionalismRating": 5,
            "handlingRating": 4,
            "communicationRating": 5,
            "feedback": "Excellent",
        })
    assert res.status_code == 201
    assert res.json()["success"] is True


@pytest.mark.asyncio
async def test_api_submit_rating_rejects_non_customer(rating_deps):
    app = make_app({"_id": ObjectId(PARTNER_USER_ID), "role": "delivery"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/delivery-ratings", json={
            "orderId": ORDER_ID,
            "overallRating": 5, "onTimeRating": 5,
            "professionalismRating": 5, "handlingRating": 5, "communicationRating": 5,
        })
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_api_submit_rating_duplicate_returns_409(rating_deps, customer_user):
    rating_deps["order"].orders[ORDER_ID] = make_order()
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    app = make_app(customer_user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/delivery-ratings", json={
            "orderId": ORDER_ID,
            "overallRating": 4, "onTimeRating": 4,
            "professionalismRating": 4, "handlingRating": 4, "communicationRating": 4,
        })
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_api_rating_validation_bounds():
    with pytest.raises(Exception):
        DeliveryRatingCreate(
            orderId=ORDER_ID,
            overallRating=0, onTimeRating=5,
            professionalismRating=5, handlingRating=5, communicationRating=5,
        )
    with pytest.raises(Exception):
        DeliveryRatingCreate(
            orderId=ORDER_ID,
            overallRating=5, onTimeRating=5,
            professionalismRating=6, handlingRating=5, communicationRating=5,
        )


@pytest.mark.asyncio
async def test_api_get_my_ratings(rating_deps, customer_user):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    app = make_app(customer_user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/delivery-ratings/me")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["pagination"]["total"] == 1


@pytest.mark.asyncio
async def test_api_get_my_ratings_requires_customer(rating_deps):
    app = make_app({"_id": ObjectId(PARTNER_USER_ID), "role": "farmer"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/delivery-ratings/me")
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_api_order_rating_status(rating_deps, customer_user):
    app = make_app(customer_user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get(f"/delivery-ratings/order/{ORDER_ID}")
    assert res.status_code == 200
    assert res.json()["data"]["rated"] is False


@pytest.mark.asyncio
async def test_api_partner_my_ratings(rating_deps):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    partner_user = {"_id": ObjectId(PARTNER_USER_ID), "role": "delivery"}
    app = make_app(partner_user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/delivery-ratings/partner/me")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["summary"]["count"] == 1
    assert "customerId" not in data["ratings"][0]


@pytest.mark.asyncio
async def test_api_partner_my_ratings_requires_delivery_role(rating_deps, customer_user):
    app = make_app(customer_user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/delivery-ratings/partner/me")
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_api_admin_list_and_delete(rating_deps):
    rating_deps["rating"].ratings[RATING_ID] = make_rating()
    admin_user = {"_id": ObjectId("888888888888888888888888"), "role": "admin"}
    app = make_app(admin_user)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/delivery-ratings/admin")
        assert res.status_code == 200
        assert res.json()["data"]["total"] == 1

        res = await client.delete(f"/delivery-ratings/{RATING_ID}")
        assert res.status_code == 200
        assert res.json()["message"] == "Rating deleted"


@pytest.mark.asyncio
async def test_api_admin_endpoints_require_admin(rating_deps, customer_user):
    app = make_app(customer_user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/delivery-ratings/admin")
        assert res.status_code == 403
        res = await client.delete(f"/delivery-ratings/{RATING_ID}")
        assert res.status_code == 403
