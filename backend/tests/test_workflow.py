"""Contract tests for the cross-role workflow resolver.

These tests intentionally mock repositories/services so they verify workflow
decisions without requiring MongoDB, Redis, payments, maps or external AI.
"""
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

from app.api.v1 import workflow


FARMER = ObjectId("507f1f77bcf86cd799439011")
CUSTOMER = ObjectId("507f1f77bcf86cd799439012")
BATCH = ObjectId("507f1f77bcf86cd799439013")
PRODUCT = ObjectId("507f1f77bcf86cd799439014")
ORDER = ObjectId("507f1f77bcf86cd799439015")


def user(oid, role):
    return {"_id": oid, "role": role}


@pytest.mark.asyncio
async def test_farmer_harvest_date_becomes_action_required(monkeypatch):
    plan = {
        "_id": FARMER,
        "farmerId": FARMER,
        "cropName": "Tomato",
        "status": "preorder",
        "expectedHarvestDate": datetime.utcnow() - timedelta(hours=1),
    }
    monkeypatch.setattr(workflow.harvests, "find_many", AsyncMock(return_value=[plan]))

    result = await workflow._farmer(str(FARMER))
    assert result["currentKey"] == "harvest"
    assert result["state"] == workflow.ACTION_REQUIRED
    assert result["next"]["label"] == "Mark Harvested"


@pytest.mark.asyncio
async def test_farmer_harvest_guides_to_batch(monkeypatch):
    plan = {
        "_id": FARMER,
        "farmerId": FARMER,
        "cropName": "Tomato",
        "status": "harvested",
        "actualQuantityKg": 480,
        "finalRatePerKg": 42,
        "harvestedAt": datetime.utcnow(),
    }
    monkeypatch.setattr(workflow.harvests, "find_many", AsyncMock(return_value=[plan]))
    monkeypatch.setattr(workflow.batches, "find_many", AsyncMock(return_value=[]))

    result = await workflow._farmer(str(FARMER))
    assert result["currentKey"] == "batch"
    assert result["state"] == workflow.ACTION_REQUIRED
    assert "fromHarvest=" + str(FARMER) in result["next"]["href"]
    assert "quantity=480" in result["next"]["href"]
    assert "price=42" in result["next"]["href"]


@pytest.mark.asyncio
async def test_farmer_quality_gate_prevents_product(monkeypatch):
    plan = {
        "_id": FARMER,
        "farmerId": FARMER,
        "cropName": "Tomato",
        "status": "harvested",
        "actualQuantityKg": 480,
        "finalRatePerKg": 42,
    }
    batch = {"_id": BATCH, "farmerId": FARMER, "sourceHarvestPlanId": FARMER, "status": "created", "verificationStatus": "declared"}
    monkeypatch.setattr(workflow.harvests, "find_many", AsyncMock(return_value=[plan]))
    monkeypatch.setattr(workflow.batches, "find_many", AsyncMock(return_value=[batch]))
    monkeypatch.setattr(workflow.quality, "find_many", AsyncMock(return_value=[]))

    result = await workflow._farmer(str(FARMER))
    assert result["currentKey"] == "quality"
    assert result["state"] == workflow.ACTION_REQUIRED


@pytest.mark.asyncio
async def test_customer_payment_is_action_required(monkeypatch):
    order = {
        "_id": ORDER,
        "customerId": CUSTOMER,
        "orderStatus": "confirmed",
        "paymentStatus": "pending",
    }
    monkeypatch.setattr(workflow.preorders, "find_many", AsyncMock(return_value=[]))
    monkeypatch.setattr(workflow.orders, "find_many", AsyncMock(return_value=[order]))

    result = await workflow._customer(str(CUSTOMER))
    assert result["currentKey"] == "payment"
    assert result["state"] == workflow.ACTION_REQUIRED
    assert result["entity"]["id"] == str(ORDER)


@pytest.mark.asyncio
async def test_customer_completed_order_requires_review(monkeypatch):
    order = {
        "_id": ORDER,
        "customerId": CUSTOMER,
        "orderStatus": "delivered",
        "paymentStatus": "paid",
    }
    monkeypatch.setattr(workflow.preorders, "find_many", AsyncMock(return_value=[]))
    monkeypatch.setattr(workflow.orders, "find_many", AsyncMock(return_value=[order]))

    result = await workflow._customer(str(CUSTOMER))
    assert result["currentKey"] == "review"
    assert result["state"] == workflow.ACTION_REQUIRED


@pytest.mark.asyncio
async def test_workflow_entity_batch_links_quality(monkeypatch):
    batch = {"_id": BATCH, "farmerId": FARMER}
    inspection = {"_id": PRODUCT, "batchId": BATCH, "verificationStatus": "declared"}
    monkeypatch.setattr(workflow.batches, "get_by_id", AsyncMock(return_value=batch))
    monkeypatch.setattr(workflow.quality, "find_one", AsyncMock(return_value=inspection))

    result = await workflow.get_entity_workflow("batch", str(BATCH), user(FARMER, "farmer"))
    assert result["data"]["state"] == workflow.IN_PROGRESS
    assert result["data"]["links"][0]["type"] == "quality"
    assert result["data"]["links"][0]["id"] == str(PRODUCT)


@pytest.mark.asyncio
async def test_role_step_states_are_explicit(monkeypatch):
    monkeypatch.setattr(workflow.harvests, "find_many", AsyncMock(return_value=[]))
    result = await workflow._farmer(str(FARMER))
    states = {step["state"] for step in result["steps"]}
    assert workflow.ACTION_REQUIRED in states
    assert workflow.NOT_STARTED in states
