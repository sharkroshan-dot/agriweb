"""API v1 package extensions.

The planned event sourcing router is attached to the existing bulk-orders
router before app.main includes it, so the existing API prefix remains:
  /api/v1/bulk-orders/*
"""
from . import bulk_orders as bulk_orders
from . import planned_event_sourcing as planned_event_sourcing

bulk_orders.router.include_router(planned_event_sourcing.router)
