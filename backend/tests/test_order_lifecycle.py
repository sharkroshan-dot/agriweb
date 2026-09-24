from app.domain.order_lifecycle import can_transition, is_terminal, validate_transition, OrderLifecycleError


def test_customer_delivery_progression():
    statuses = ["pending", "confirmed", "processing", "ready_for_delivery", "dispatched", "in_transit", "delivered"]
    for current, target in zip(statuses, statuses[1:]):
        assert can_transition(current, target)


def test_pickup_progression():
    assert can_transition("processing", "ready_for_pickup")
    assert can_transition("ready_for_pickup", "picked_up")
    assert is_terminal("picked_up")


def test_invalid_skip_is_rejected():
    assert not can_transition("pending", "delivered")
    try:
        validate_transition("pending", "delivered")
    except OrderLifecycleError:
        pass
    else:
        raise AssertionError("invalid transition accepted")


def test_terminal_statuses_do_not_progress():
    assert not can_transition("cancelled", "confirmed")
    assert not can_transition("refunded", "delivered")
