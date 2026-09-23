"""In-memory pub/sub broker for real-time delivery-map updates.

The Order Map page subscribes to a Server-Sent-Events stream and refetches
whenever an order is accepted for self delivery, assigned to a partner,
switched between the two, or completed. Events are scoped per farmer so a
broadcast only reaches the dashboard that owns the orders.

Because the broker lives in memory, it is per-process: when multiple backend
replicas are running, only the process that handled the mutation publishes to
its own subscribers. The client-side polling fallback (kept at a slower
interval) covers the multi-replica case.
"""

import asyncio
import json
import logging
from typing import Any, Dict, Set

logger = logging.getLogger(__name__)


class DeliveryMapEventBroker:
    """A tiny per-process pub/sub hub keyed by farmer id."""

    def __init__(self) -> None:
        self._subscribers: Dict[str, Set[asyncio.Queue]] = {}

    def subscribe(self, scope: str) -> asyncio.Queue:
        """Register a queue for a farmer and return it to the stream generator."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.setdefault(scope, set()).add(queue)
        return queue

    def unsubscribe(self, scope: str, queue: asyncio.Queue) -> None:
        subscribers = self._subscribers.get(scope)
        if subscribers:
            subscribers.discard(queue)
            if not subscribers:
                self._subscribers.pop(scope, None)

    async def publish(self, scope: str, event: Dict[str, Any]) -> None:
        """Push an event to every subscriber of ``scope``."""
        subscribers = self._subscribers.get(scope)
        if not subscribers:
            return
        payload = json.dumps(event, default=str, ensure_ascii=False)
        for queue in list(subscribers):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Never let a slow consumer block the mutation handlers: drop
                # the oldest buffered event for that subscriber and retry.
                try:
                    queue.get_nowait()
                    queue.put_nowait(payload)
                except Exception:
                    pass

    def subscriber_count(self, scope: str) -> int:
        return len(self._subscribers.get(scope, set()))


delivery_map_event_broker = DeliveryMapEventBroker()
