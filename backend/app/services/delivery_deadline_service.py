"""Delivery deadline calculation, kept separate from priority."""
from __future__ import annotations
from datetime import datetime, timedelta
from typing import Optional
MAX_DELIVERY_WINDOW_DAYS = 4

def business_deadline(order_created_at: datetime, customer_requested_date: Optional[datetime] = None) -> datetime:
    deadline = order_created_at + timedelta(days=MAX_DELIVERY_WINDOW_DAYS)
    if customer_requested_date:
        deadline = min(deadline, customer_requested_date)
    return deadline

def effective_delivery_deadline(order_created_at: datetime, batch_safe_date: Optional[datetime] = None, customer_requested_date: Optional[datetime] = None) -> datetime:
    deadline = business_deadline(order_created_at, customer_requested_date)
    return min(deadline, batch_safe_date) if batch_safe_date else deadline
