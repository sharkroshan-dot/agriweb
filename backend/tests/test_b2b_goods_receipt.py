from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.api.v1 import b2b as b2b_mod


BUSINESS_ID = ObjectId("64d1d6a7d9cea7f7d43d4f9a")
FARMER_ID = ObjectId("64d1d6a7d9cea7f7d43d4f9b")
ORDER_ID = ObjectId("64d1d6a7d9cea7f7d43d4f9c")


def _delivered_order(**overrides):
    order = {
        "_id": ORDER_ID,
        "businessUserId": BUSINESS_ID,
        "farmerId": FARMER_ID,
        "orderNumber": "B2B-RECEIPT-001",
        "productName": "Brinjal",
        "quantityKg": 10,
        "pricePerKg": 40,
        "totalAmount": 450,
        "paymentStatus": "advance",
        "paidAmount": 100,
        "status": b2b_mod.ORDER_DELIVERED,
        "createdAt": "2026-11-01T08:00:00",
        "deliveredAt": "2026-11-02T10:00:00",
        "deletedAt": None,
    }
    order.update(overrides)
    return order


@pytest.mark.asyncio
async def test_full_goods_receipt_completes_order_and_preserves_payment(monkeypatch):
    order = _delivered_order()
    saved_updates = {}

    async def find_one(query):
        assert query["businessUserId"] == BUSINESS_ID
        return order

    async def update(query, data):
        saved_updates.update(data)
        return True

    monkeypatch.setattr(b2b_mod.order_repo, "find_one", find_one)
    monkeypatch.setattr(b2b_mod.order_repo, "update", update)
    monkeypatch.setattr(
        b2b_mod.NotificationService,
        "create_in_app_notification",
        AsyncMock(return_value=None),
    )

    result = await b2b_mod.submit_b2b_goods_receipt(
        str(ORDER_ID),
        b2b_mod.GoodsReceiptSubmit(
            receivedQuantityKg=10,
            acceptedQuantityKg=10,
            issues=[],
            notes="All produce received in good condition.",
        ),
        {"_id": str(BUSINESS_ID), "role": "business"},
    )

    assert result["data"]["orderStatus"] == b2b_mod.ORDER_COMPLETED
    assert saved_updates["status"] == b2b_mod.ORDER_COMPLETED
    assert saved_updates["goodsReceipt"]["status"] == "accepted"
    assert saved_updates["goodsReceipt"]["acceptedQuantityKg"] == 10
    assert saved_updates["completedAt"]
    assert saved_updates["invoiceIssuedAt"]
    assert order["paymentStatus"] == "advance"
    assert order["paidAmount"] == 100
    assert result["data"]["paymentStatus"] == "advance"
    assert result["data"]["amountDue"] == 350


@pytest.mark.asyncio
async def test_quantity_or_quality_discrepancy_keeps_order_delivered_and_opens_dispute(monkeypatch):
    order = _delivered_order()
    saved_updates = {}

    async def find_one(query):
        return order

    async def update(query, data):
        saved_updates.update(data)
        return True

    monkeypatch.setattr(b2b_mod.order_repo, "find_one", find_one)
    monkeypatch.setattr(b2b_mod.order_repo, "update", update)
    monkeypatch.setattr(
        b2b_mod.NotificationService,
        "create_in_app_notification",
        AsyncMock(return_value=None),
    )

    result = await b2b_mod.submit_b2b_goods_receipt(
        str(ORDER_ID),
        b2b_mod.GoodsReceiptSubmit(
            receivedQuantityKg=10,
            acceptedQuantityKg=8,
            issues=["quality_issue"],
            notes="Two kg were soft and not suitable for use.",
            evidenceUrls=["https://example.com/evidence/brinjal-inspection.jpg"],
        ),
        {"_id": str(BUSINESS_ID), "role": "business"},
    )

    assert result["data"]["orderStatus"] == b2b_mod.ORDER_DELIVERED
    assert "status" not in saved_updates
    assert saved_updates["goodsReceipt"]["status"] == "dispute_open"
    assert saved_updates["goodsReceipt"]["acceptedQuantityKg"] == 8
    assert "quality_issue" in saved_updates["goodsReceipt"]["issueTypes"]
    assert saved_updates["goodsReceipt"]["evidenceUrls"] == [
        "https://example.com/evidence/brinjal-inspection.jpg"
    ]
    assert order["paymentStatus"] == "advance"
    assert order["paidAmount"] == 100


@pytest.mark.asyncio
async def test_farmer_can_respond_to_open_goods_receipt_dispute(monkeypatch):
    order = _delivered_order(goodsReceipt={
        "status": "dispute_open",
        "requestedQuantityKg": 10,
        "receivedQuantityKg": 10,
        "acceptedQuantityKg": 8,
        "issueTypes": ["quality_issue"],
    })
    saved_updates = {}

    async def find_one(query):
        assert query["farmerId"] == FARMER_ID
        return order

    async def update(query, data):
        saved_updates.update(data)
        return True

    monkeypatch.setattr(b2b_mod.order_repo, "find_one", find_one)
    monkeypatch.setattr(b2b_mod.order_repo, "update", update)
    monkeypatch.setattr(
        b2b_mod.NotificationService,
        "create_in_app_notification",
        AsyncMock(return_value=None),
    )

    result = await b2b_mod.respond_to_b2b_goods_receipt_dispute(
        str(ORDER_ID),
        b2b_mod.GoodsReceiptFarmerResponse(
            proposal="replacement",
            notes="We can deliver replacement produce tomorrow morning.",
        ),
        {"_id": str(FARMER_ID), "role": "farmer"},
    )

    assert result["data"]["goodsReceipt"]["status"] == "response_received"
    assert result["data"]["goodsReceipt"]["farmerResponse"]["proposal"] == "replacement"
    assert saved_updates["goodsReceipt"]["farmerResponse"]["notes"].startswith("We can deliver")


@pytest.mark.asyncio
async def test_business_can_resolve_dispute_without_changing_payment_balance(monkeypatch):
    order = _delivered_order(goodsReceipt={
        "status": "response_received",
        "requestedQuantityKg": 10,
        "receivedQuantityKg": 10,
        "acceptedQuantityKg": 8,
        "issueTypes": ["quality_issue"],
        "farmerResponse": {
            "proposal": "credit_or_refund",
            "notes": "Please accept a credit for the rejected quantity.",
        },
    })
    saved_updates = {}

    async def find_one(query):
        assert query["businessUserId"] == BUSINESS_ID
        return order

    async def update(query, data):
        assert query["goodsReceipt.status"] == "response_received"
        saved_updates.update(data)
        return True

    monkeypatch.setattr(b2b_mod.order_repo, "find_one", find_one)
    monkeypatch.setattr(b2b_mod.order_repo, "update", update)
    monkeypatch.setattr(
        b2b_mod.NotificationService,
        "create_in_app_notification",
        AsyncMock(return_value=None),
    )

    result = await b2b_mod.resolve_b2b_goods_receipt_dispute(
        str(ORDER_ID),
        b2b_mod.GoodsReceiptResolution(
            resolution="credit_or_refund_agreed",
            notes="Both parties agreed that the credit will be processed separately.",
        ),
        {"_id": str(BUSINESS_ID), "role": "business"},
    )

    assert saved_updates["goodsReceipt"]["status"] == "resolved"
    assert saved_updates["goodsReceipt"]["resolution"] == "credit_or_refund_agreed"
    assert result["data"]["paymentStatus"] == "advance"
    assert result["data"]["amountDue"] == 350
    assert order["paymentStatus"] == "advance"
    assert order["paidAmount"] == 100


@pytest.mark.asyncio
async def test_disputed_order_cannot_bypass_receipt_resolution_with_complete_status(monkeypatch):
    order = _delivered_order(goodsReceipt={"status": "dispute_open"})

    async def find_one(query):
        return order

    update = AsyncMock(return_value=True)
    monkeypatch.setattr(b2b_mod.order_repo, "find_one", find_one)
    monkeypatch.setattr(b2b_mod.order_repo, "update", update)

    with pytest.raises(HTTPException) as exc:
        await b2b_mod.update_order_status(
            str(ORDER_ID),
            b2b_mod.OrderStatusUpdate(status=b2b_mod.ORDER_COMPLETED),
            {"_id": str(BUSINESS_ID), "role": "business"},
        )

    assert exc.value.status_code == 409
    assert "goods receipt" in exc.value.detail.lower()
    update.assert_not_awaited()


def test_goods_receipt_rejects_non_http_evidence_urls():
    with pytest.raises(HTTPException) as exc:
        b2b_mod._validate_goods_receipt_evidence_urls(["javascript:alert(1)"])
    assert exc.value.status_code == 400


def test_goods_receipt_limits_evidence_link_count():
    urls = [f"https://example.com/evidence/{index}.jpg" for index in range(6)]
    with pytest.raises(HTTPException) as exc:
        b2b_mod._validate_goods_receipt_evidence_urls(urls)
    assert exc.value.status_code == 400
