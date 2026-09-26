# backend/app/database/mongodb.py
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import Optional
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

class MongoDB:
    """MongoDB database connection manager."""
    
    client: Optional[AsyncIOMotorClient] = None
    db: Optional[AsyncIOMotorDatabase] = None
    
    @classmethod
    async def connect(cls):
        """Connect to MongoDB."""
        try:
            uri = settings.MONGODB_URI
            if settings.MONGODB_USER and settings.MONGODB_PASSWORD:
                uri = uri.replace("mongodb://", f"mongodb://{settings.MONGODB_USER}:{settings.MONGODB_PASSWORD}@")

            cls._validate_uri(uri)

            client_options: dict = {"maxPoolSize": 50, "minPoolSize": 10}
            # Production safety rails: TLS + auth + write safety on remote hosts.
            if getattr(settings, "MONGODB_TLS", False):
                client_options["tls"] = True
                client_options["tlsAllowInvalidCertificates"] = False
            if getattr(settings, "MONGODB_AUTH_SOURCE", None):
                client_options["authSource"] = settings.MONGODB_AUTH_SOURCE
            if getattr(settings, "MONGODB_RETRY_WRITES", True):
                client_options["retryWrites"] = True

            cls.client = AsyncIOMotorClient(uri, **client_options)
            cls.db = cls.client[settings.MONGODB_DATABASE]

            await cls.client.admin.command('ping')
            logger.info(f"✅ Connected to MongoDB: {settings.MONGODB_DATABASE}")

            await cls.create_indexes()

        except Exception as e:
            logger.error(f"❌ Failed to connect to MongoDB: {str(e)}")
            raise

    @classmethod
    def _validate_uri(cls, uri: str) -> None:
        """Fail-fast on clearly unsafe production connection strings.

        Warns (but does not block local development) when a non-local URI has
        no embedded credentials and no TLS requested.
        """
        if not uri.startswith("mongodb://") and not uri.startswith("mongodb+srv://"):
            raise ValueError("MONGODB_URI must start with mongodb:// or mongodb+srv://")

        local_host = any(h in uri for h in ("localhost", "127.0.0.1", "0.0.0.0", "::1"))
        if local_host:
            return

        production = not getattr(settings, "DEBUG", False)
        if production and not settings.MONGODB_USER and "tls" not in uri and not getattr(settings, "MONGODB_TLS", False):
            logger.warning(
                "⚠️ MongoDB: connecting to a remote host without credentials and without TLS. "
                "Set MONGODB_USER/MONGODB_PASSWORD and MONGODB_TLS=true in production."
            )
    
    @classmethod
    async def close(cls):
        """Close MongoDB connection."""
        if cls.client:
            cls.client.close()
            logger.info("✅ MongoDB connection closed")
    
    @classmethod
    async def health_check(cls) -> bool:
        """Check database health."""
        try:
            await cls.client.admin.command('ping')
            return True
        except Exception:
            return False
    
    @classmethod
    async def create_indexes(cls):
        """Create necessary indexes for collections."""
        # Users
        await cls.db.users.create_index("email", unique=True)
        await cls.db.users.create_index("phone", unique=True)
        
        # Products
        await cls.db.products.create_index("farmer_id")
        await cls.db.products.create_index("slug", unique=True)
        await cls.db.products.create_index([("name", "text"), ("description", "text")])
        
        # Geospatial
        await cls.db.farmer_profiles.create_index([("location", "2dsphere")])
        await cls.db.addresses.create_index([("location", "2dsphere")])
        await cls.db.products.create_index([("location", "2dsphere")])
        await cls.db.orders.create_index([("deliveryAddress.location", "2dsphere")])
        await cls.db.delivery_profiles.create_index([("currentLocation", "2dsphere")])
        await cls.db.delivery_jobs.create_index([("pickupLocation", "2dsphere")])
        await cls.db.delivery_jobs.create_index([("status", 1), ("expiresAt", 1)])
        try:
            await cls.db.delivery_jobs.create_index("orderId", unique=True, sparse=True)
        except Exception:
            await cls.db.delivery_jobs.create_index("orderId", unique=True)
        
        # Orders
        try:
            await cls.db.orders.drop_index("order_number_1")
        except Exception:
            pass
        await cls.db.orders.create_index("orderNumber", unique=True)
        await cls.db.orders.create_index("customer_id")
        await cls.db.orders.create_index("farmer_id")
        
        # Inventory
        await cls.db.inventory.create_index("product_id", unique=True)
        await cls.db.inventory.create_index("farmer_id")
        
        # Reservations
        await cls.db.reservations.create_index("product_id")
        await cls.db.reservations.create_index("customer_id")
        await cls.db.reservations.create_index([("status", 1), ("expires_at", 1)])
        
        # Delivery partner ratings (one rating per order)
        await cls.db.delivery_ratings.create_index("orderId", unique=True)
        await cls.db.delivery_ratings.create_index("deliveryPartnerId")
        await cls.db.delivery_ratings.create_index("customerId")

        # Auth sessions (lookup + cleanup)
        await cls.db.auth_sessions.create_index([("userId", 1), ("revoked", 1)])
        await cls.db.auth_sessions.create_index("jti")
        # Financial ledger (immutable, indexed for reconciliation queries)
        await cls.db.ledger_entries.create_index([("userId", 1), ("createdAt", -1)])
        await cls.db.ledger_entries.create_index([("orderId", 1), ("type", 1)])
        # Stable gateway/webhook references must be unique for the same
        # financial event so concurrent retries cannot create duplicate ledger
        # entries. Existing legacy duplicates are tolerated at startup.
        try:
            await cls.db.ledger_entries.create_index(
                [("reference", 1), ("type", 1), ("direction", 1), ("amount", 1)],
                unique=True,
                sparse=True,
                name="ledger_reference_idempotency",
            )
        except Exception as exc:
            logger.warning("Ledger idempotency index could not be created: %s", exc)
        # Wallet transaction recovery/idempotency lookups
        await cls.db.wallet_transactions.create_index([("referenceId", 1), ("referenceType", 1), ("type", 1)])
        await cls.db.wallet_transactions.create_index([("walletId", 1), ("createdAt", -1)])
        # Warehouse lifecycle lookups
        await cls.db.warehouse_stock.create_index([("warehouseId", 1), ("productId", 1), ("variantId", 1)])
        await cls.db.incoming_stock.create_index([("warehouseId", 1), ("status", 1), ("expectedDate", 1)])
        await cls.db.warehouse_transfers.create_index([("fromWarehouseId", 1), ("status", 1)])
        await cls.db.warehouse_transfers.create_index([("toWarehouseId", 1), ("status", 1)])

        # AI training jobs
        await cls.db.ai_training_jobs.create_index([("status", 1), ("createdAt", -1)])
        await cls.db.ai_training_jobs.create_index([("modelType", 1), ("createdAt", -1)])
        await cls.db.ai_training_jobs.create_index("requestedBy")

        # Audit log lookups (TTL index is created at startup separately)
        await cls.db.audit_logs.create_index([("action", 1), ("createdAt", -1)])
        await cls.db.audit_logs.create_index("actorId")

        logger.info("✅ Database indexes created")
    
    @classmethod
    def get_collection(cls, name: str):
        """Get a collection by name."""
        if cls.db is None:
            raise RuntimeError("Database not connected")
        return cls.db[name]
