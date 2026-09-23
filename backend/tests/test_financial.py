"""Financial integrity tests for the Phase 3 work.

Covers:
- Bank-account change cooldown (anti fraud on withdrawals)
- Financial ledger recording (payment received, refund, withdrawal)
- Ledger validation (direction / entry types)
"""
from datetime import datetime, timedelta

import pytest

from app.services.ledger_service import ledger_service
from app.services.payment_service import PaymentService
from app.schemas.payment import WalletWithdraw
from app.repositories.ledger_repository import ledger_repository

BANK_A = {"accountNumber": "1234567890", "ifsc": "HDFC0001234", "accountHolderName": "Asha Devi"}
BANK_B = {"accountNumber": "0987654321", "ifsc": "ICIC0009876", "accountHolderName": "Asha Devi"}


# ---------------- Bank account hash ----------------

def test_bank_account_hash_is_stable():
    assert PaymentService._bank_account_hash(BANK_A) == PaymentService._bank_account_hash(BANK_A)


def test_bank_account_hash_differentiates_accounts():
    assert PaymentService._bank_account_hash(BANK_A) != PaymentService._bank_account_hash(BANK_B)


# ---------------- Bank change cooldown ----------------

def _recent_withdrawal(bank_account, created_at=None):
    return {
        "_id": "wd1",
        "bankAccount": bank_account,
        "createdAt": created_at or datetime.utcnow(),
    }


@pytest.mark.asyncio
async def test_cooldown_blocks_different_account(monkeypatch):
    async def _get_recent(*a, **k):
        return [_recent_withdrawal(BANK_A)]

    monkeypatch.setattr(
        "app.repositories.withdrawal_repository.withdrawal_repository.get_by_user_id",
        _get_recent,
    )
    blocked = await PaymentService._bank_change_cooldown_blocked("user1", BANK_B)
    assert blocked and "cooldown" in blocked.lower()


@pytest.mark.asyncio
async def test_cooldown_allows_same_account(monkeypatch):
    async def _get_recent(*a, **k):
        return [_recent_withdrawal(BANK_A)]

    monkeypatch.setattr(
        "app.repositories.withdrawal_repository.withdrawal_repository.get_by_user_id",
        _get_recent,
    )
    assert await PaymentService._bank_change_cooldown_blocked("user1", BANK_A) is None


@pytest.mark.asyncio
async def test_cooldown_ignores_old_withdrawals(monkeypatch):
    old = datetime.utcnow() - timedelta(hours=24 * 10)

    async def _get_recent(*a, **k):
        return [_recent_withdrawal(BANK_A, created_at=old)]

    monkeypatch.setattr(
        "app.repositories.withdrawal_repository.withdrawal_repository.get_by_user_id",
        _get_recent,
    )
    assert await PaymentService._bank_change_cooldown_blocked("user1", BANK_B) is None


@pytest.mark.asyncio
async def test_cooldown_ignores_withdrawals_without_bank(monkeypatch):
    async def _get_recent(*a, **k):
        return [{"_id": "wd1", "createdAt": datetime.utcnow()}]

    monkeypatch.setattr(
        "app.repositories.withdrawal_repository.withdrawal_repository.get_by_user_id",
        _get_recent,
    )
    assert await PaymentService._bank_change_cooldown_blocked("user1", BANK_B) is None


# ---------------- Ledger recording ----------------

@pytest.mark.asyncio
async def test_ledger_record_persists_typed_entry(monkeypatch):
    captured = {}

    async def fake_create(entry):
        captured.update(entry)
        return "ledger_id"

    monkeypatch.setattr(ledger_repository, "create_entry", fake_create)
    entry_id = await ledger_service.record(
        amount=100.0,
        direction="credit",
        entry_type="payment_received",
        user_id="abc123",
    )
    assert entry_id == "ledger_id"
    assert captured["amount"] == 100.0
    assert captured["direction"] == "credit"
    assert captured["type"] == "payment_received"
    assert captured["status"] == "posted"
    assert captured["txId"].startswith("ledger_")
    assert "userId" in captured


@pytest.mark.asyncio
async def test_ledger_record_rejects_bad_direction(monkeypatch):
    captured = []

    async def fake_create(entry):
        captured.append(entry)

    monkeypatch.setattr(ledger_repository, "create_entry", fake_create)
    result = await ledger_service.record(
        amount=10.0, direction="sideways", entry_type="refund"
    )
    assert result is None
    assert captured == []


@pytest.mark.asyncio
async def test_refund_records_ledger_entry(monkeypatch):
    captured = {}

    async def fake_create(entry):
        captured.update(entry)
        return "ledger_id"

    monkeypatch.setattr(ledger_repository, "create_entry", fake_create)
    payment = {"_id": "pay1", "userId": "user1", "transactionId": "tx_123"}
    await PaymentService._record_refund_ledger(payment, "order1", 250.0)
    assert captured["type"] == "refund"
    assert captured["direction"] == "debit"
    assert captured["amount"] == 250.0


@pytest.mark.asyncio
async def test_finalize_payment_records_payment_received(monkeypatch):
    captured = {}

    async def fake_create(entry):
        captured.update(entry)
        return "ledger_id"

    monkeypatch.setattr(ledger_repository, "create_entry", fake_create)
    async def _ok(*a, **k):
        return True

    monkeypatch.setattr(
        "app.repositories.payment_repository.payment_repository.update_payment_status",
        _ok,
    )
    monkeypatch.setattr(
        "app.services.payment_service.order_repository.update",
        _ok,
    )
    async def _splits(payment_id):
        return True

    monkeypatch.setattr(PaymentService, "create_payment_splits", _splits)
    monkeypatch.setattr(
        "app.services.notification_service.NotificationService.send_payment_success",
        _ok,
    )
    async def _get_payment(payment_id):
        return dict(payment)

    monkeypatch.setattr(
        "app.repositories.payment_repository.payment_repository.get_by_id",
        _get_payment,
    )

    payment = {
        "_id": "pay1",
        "userId": "user1",
        "orderId": "order1",
        "amount": 500.0,
        "transactionId": "pi_123",
    }
    result = await PaymentService._finalize_successful_payment(payment, {"status": "succeeded"})
    assert result is not None
    assert captured["type"] == "payment_received"
    assert captured["amount"] == 500.0
    assert captured["reference"] == "pi_123"


@pytest.mark.asyncio
async def test_withdraw_wallet_records_ledger_entry(monkeypatch):
    USER_ID = "507f1f77bcf86cd799439011"
    captured = {}

    async def fake_create(entry):
        captured.update(entry)
        return "ledger_id"

    monkeypatch.setattr(ledger_repository, "create_entry", fake_create)
    wallet = {
        "_id": "w1",
        "userId": "user1",
        "balance": 1000.0,
    }

    async def fake_get_by_user_id(user_id):
        return wallet

    async def fake_get_by_id(wallet_id):
        return dict(wallet, balance=wallet.get("balance", 0))

    async def fake_update_balance(*a, **k):
        return True

    async def fake_create_withdrawal(record):
        return "507f1f77bcf86cd799439012"

    async def fake_update_status(*a, **k):
        return True

    async def fake_create_transaction(tx):
        return "tx1"

    async def fake_notify(*a, **k):
        return True

    monkeypatch.setattr("app.repositories.wallet_repository.wallet_repository.get_by_user_id", fake_get_by_user_id)
    monkeypatch.setattr("app.repositories.wallet_repository.wallet_repository.get_by_id", fake_get_by_id)
    monkeypatch.setattr("app.repositories.wallet_repository.wallet_repository.update_balance", fake_update_balance)
    monkeypatch.setattr("app.repositories.withdrawal_repository.withdrawal_repository.create", fake_create_withdrawal)
    monkeypatch.setattr("app.repositories.withdrawal_repository.withdrawal_repository.update_status", fake_update_status)
    monkeypatch.setattr("app.repositories.wallet_repository.wallet_transaction_repository.create_transaction", fake_create_transaction)
    async def fake_payouts_enabled():
        return False

    async def fake_no_cooldown(user_id, bank):
        return None

    monkeypatch.setattr(PaymentService, "_payouts_enabled", fake_payouts_enabled)
    monkeypatch.setattr(PaymentService, "_bank_change_cooldown_blocked", fake_no_cooldown)

    async def fake_build_fund_account(bank, strict=False):
        return ("bank_account", {}, "NEFT")

    monkeypatch.setattr(PaymentService, "_build_fund_account_payload", fake_build_fund_account)
    monkeypatch.setattr(
        "app.services.notification_service.NotificationService.send_wallet_debit", fake_notify
    )

    result = await PaymentService.withdraw_wallet_funds(USER_ID, WalletWithdraw(amount=200.0, bankAccount=BANK_A))
    assert result.get("success") is True
    assert captured["type"] == "withdrawal"
    assert captured["direction"] == "debit"
    assert captured["amount"] == 200.0
    assert "bankAccountHash" in captured["metadata"]
