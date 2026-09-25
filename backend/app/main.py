# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from contextlib import asynccontextmanager
from datetime import datetime
import logging
import os
from bson import ObjectId
import fastapi.encoders as _fastapi_encoders

from app.core.config import settings
from app.core.logging import setup_logging
from app.core.exceptions import setup_exception_handlers
from app.database.mongodb import MongoDB
from app.database.redis import RedisClient
from app.services.inventory_service import inventory_service

# Monkey-patch FastAPI's jsonable_encoder to handle BSON ObjectId globally
import fastapi.routing as _fastapi_routing
_original_jsonable_encoder = _fastapi_encoders.jsonable_encoder

def _jsonable_encoder_with_objectid(obj, *args, **kwargs):
    if isinstance(obj, ObjectId):
        return str(obj)
    return _original_jsonable_encoder(obj, *args, **kwargs)

# Replace in all modules that imported it (they hold local references)
_fastapi_encoders.jsonable_encoder = _jsonable_encoder_with_objectid
_fastapi_routing.jsonable_encoder = _jsonable_encoder_with_objectid

# Setup logging
logger = setup_logging()

DEFAULT_CATEGORIES = [
    {"name": "Vegetables", "slug": "vegetables", "description": "Fresh vegetables", "icon": "🥬", "isActive": True},
    {"name": "Fruits", "slug": "fruits", "description": "Fresh fruits", "icon": "🍎", "isActive": True},
    {"name": "Dairy", "slug": "dairy", "description": "Milk, cheese, yogurt", "icon": "🥛", "isActive": True},
    {"name": "Grains", "slug": "grains", "description": "Rice, wheat, cereals", "icon": "🌾", "isActive": True},
    {"name": "Spices", "slug": "spices", "description": "Spices and seasonings", "icon": "🌶️", "isActive": True},
    {"name": "Herbs", "slug": "herbs", "description": "Fresh herbs", "icon": "🌿", "isActive": True},
    {"name": "Poultry", "slug": "poultry", "description": "Chicken, eggs", "icon": "🐔", "isActive": True},
    {"name": "Meat", "slug": "meat", "description": "Fresh meat", "icon": "🥩", "isActive": True},
    {"name": "Seafood", "slug": "seafood", "description": "Fish and seafood", "icon": "🐟", "isActive": True},
    {"name": "Nuts & Seeds", "slug": "nuts-seeds", "description": "Dry fruits and seeds", "icon": "🥜", "isActive": True},
    {"name": "Beverages", "slug": "beverages", "description": "Juices and drinks", "icon": "🧃", "isActive": True},
    {"name": "Organic", "slug": "organic", "description": "Certified organic produce", "icon": "🌱", "isActive": True},
]

async def seed_categories():
    try:
        from app.database.mongodb import MongoDB
        import datetime
        collection = MongoDB.get_collection("categories")
        count = await collection.count_documents({})
        if count == 0:
            now = datetime.datetime.utcnow()
            for cat in DEFAULT_CATEGORIES:
                cat["createdAt"] = now
                cat["updatedAt"] = now
            await collection.insert_many(DEFAULT_CATEGORIES)
            logger.info(f"✅ Seeded {len(DEFAULT_CATEGORIES)} default categories")
        else:
            logger.info(f"ℹ️  Categories collection already has {count} entries")
    except Exception as exc:
        logger.warning(f"⚠️ Category seeding warning: {exc}")

import asyncio

async def reservation_expiry_loop():
    """Periodically expire stale reservations every 60 seconds."""
    while True:
        try:
            await inventory_service.expire_reservations()
        except Exception as e:
            logger.warning(f"Reservation expiry error: {e}")
        await asyncio.sleep(60)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 Starting AgriConnect AI Backend...")
    expiry_task = None
    try:
        await MongoDB.connect()
        await RedisClient.connect()
        await seed_categories()
        from app.repositories.audit_log_repository import audit_log_repository
        await audit_log_repository.ensure_ttl_index()
        expiry_task = asyncio.create_task(reservation_expiry_loop())
        from app.api.v1 import subscriptions as _subscriptions
        basket_task = asyncio.create_task(_subscriptions.basket_scheduler_loop())
        logger.info("✅ Database connections established")
    except Exception as exc:
        logger.warning(f"⚠️ Database startup warning: {exc}")
    yield
    # Shutdown
    logger.info("🛑 Shutting down...")
    if expiry_task:
        expiry_task.cancel()
    if basket_task:
        basket_task.cancel()
    try:
        await MongoDB.close()
        await RedisClient.close()
    except Exception as exc:
        logger.warning(f"⚠️ Shutdown warning: {exc}")
    logger.info("✅ Database connections closed")

# Create app
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Smart Agriculture Marketplace API",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan
)

# Serve uploaded files
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# CORS
cors_origins = settings.BACKEND_CORS_ORIGINS
cors_regex = settings.BACKEND_CORS_ORIGIN_REGEX
if settings.DEBUG:
    cors_regex = r".*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting (per-IP, stricter on auth endpoints)
from app.middleware.rate_limit import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware)

# Security headers (CSP, HSTS, X-Frame-Options, etc.)
from app.middleware.security_headers import SecurityHeadersMiddleware
app.add_middleware(SecurityHeadersMiddleware)

# Exception handlers
setup_exception_handlers(app)

@app.get("/")
async def root():
    return {
        "message": f"Welcome to {settings.PROJECT_NAME} API",
        "version": settings.VERSION,
        "status": "operational",
        "docs": "/api/docs"
    }


@app.get("/docs", include_in_schema=False)
async def legacy_docs():
    return RedirectResponse(url="/api/docs", status_code=307)

@app.get("/redoc", include_in_schema=False)
async def legacy_redoc():
    return RedirectResponse(url="/api/redoc", status_code=307)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "services": {
            "database": await MongoDB.health_check(),
            "redis": await RedisClient.health_check()
        },
        "timestamp": datetime.utcnow().isoformat()
    }

# Import and include routers
from app.api.v1 import auth, users, products, orders, payments, farmers, warehouse, delivery, notifications, analytics, community_delivery, customers, marketplace, logistics, community_buying
from app.api.v1 import admin, coupons, complaints, kyc, settings as settings_router, delivery_ratings
from app.api.v1 import quality
try:
    from app.api.v1 import ai
    _ai_router = ai.router
except Exception:
    from app.api.v1 import ai_stubs
    _ai_router = ai_stubs.router
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(products.router, prefix="/api/v1/products", tags=["Products"])
app.include_router(orders.router, prefix="/api/v1/orders", tags=["Orders"])
app.include_router(payments.router, prefix="/api/v1/payments", tags=["Payments"])
app.include_router(farmers.router, prefix="/api/v1/farmers", tags=["Farmers"])
app.include_router(warehouse.router, prefix="/api/v1/warehouse", tags=["Warehouse"])
app.include_router(delivery.router, prefix="/api/v1/delivery", tags=["Delivery"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["Analytics"])
app.include_router(community_delivery.router, prefix="/api/v1/community-delivery", tags=["Community Delivery"])
app.include_router(marketplace.router, prefix="/api/v1/marketplace", tags=["Marketplace"])
app.include_router(logistics.router, prefix="/api/v1/logistics", tags=["Logistics"])
app.include_router(community_buying.router, prefix="/api/v1/community-buying", tags=["Community Buying"])
app.include_router(customers.router, prefix="/api/v1/customers", tags=["Customers"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])
app.include_router(coupons.router, prefix="/api/v1/coupons", tags=["Coupons"])
app.include_router(complaints.router, prefix="/api/v1/complaints", tags=["Complaints"])
app.include_router(delivery_ratings.router, prefix="/api/v1/delivery-ratings", tags=["Delivery Ratings"])
app.include_router(kyc.router, prefix="/api/v1/kyc", tags=["KYC"])
app.include_router(settings_router.router, prefix="/api/v1/settings", tags=["Settings"])
from app.api.v1 import chat
app.include_router(chat.router, prefix="/api/v1/chat", tags=["Chat"])
from app.api.v1 import inventory
app.include_router(inventory.router, prefix="/api/v1/inventory", tags=["Inventory"])
from app.api.v1 import harvests
app.include_router(harvests.router, prefix="/api/v1/harvests", tags=["Harvests"])
from app.api.v1 import delivery_slots
app.include_router(delivery_slots.router, prefix="/api/v1/delivery-slots", tags=["Delivery Slots"])
from app.api.v1 import impact
app.include_router(impact.router, prefix="/api/v1/impact", tags=["Impact"])
from app.api.v1 import loyalty
app.include_router(loyalty.router, prefix="/api/v1/loyalty", tags=["Loyalty"])
from app.api.v1 import b2b
app.include_router(b2b.router, prefix="/api/v1/b2b", tags=["B2B"])
from app.api.v1 import bulk_orders
app.include_router(bulk_orders.router, prefix="/api/v1/bulk-orders", tags=["Bulk Orders"])
from app.api.v1 import batches
app.include_router(batches.router, prefix="/api/v1/batches", tags=["Batches"])
from app.api.v1 import subscriptions
app.include_router(subscriptions.router, prefix="/api/v1/subscriptions", tags=["Subscriptions"])
from app.api.v1 import refunds
app.include_router(refunds.router, prefix="/api/v1/refunds", tags=["Refunds"])
app.include_router(quality.router, prefix="/api/v1/quality", tags=["Quality"])
app.include_router(_ai_router, prefix="/api/v1/ai", tags=["AI"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="::",
        port=8000,
        reload=settings.DEBUG
    )
