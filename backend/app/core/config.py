from pathlib import Path
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import validator
import os
from dotenv import load_dotenv

ROOT_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
if ROOT_ENV_PATH.exists():
    load_dotenv(ROOT_ENV_PATH)
else:
    load_dotenv()

class Settings(BaseSettings):
    # Project
    PROJECT_NAME: str = "AgriConnect AI"
    VERSION: str = "1.0.0"
    DEBUG: bool = True
    ENVIRONMENT: str = "development"
    
    # API
    API_V1_STR: str = "/api/v1"
    BACKEND_CORS_ORIGINS: List[str] = []
    BACKEND_CORS_ORIGIN_REGEX: Optional[str] = None
    ALLOWED_HOSTS: List[str] = ["*"]
    
    # Database
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DATABASE: str = "agri"
    MONGODB_USER: Optional[str] = None
    MONGODB_PASSWORD: Optional[str] = None
    # Enable TLS for remote MongoDB (set true in production).
    MONGODB_TLS: bool = False
    # Auth database for MongoDB credentials (usually "admin").
    MONGODB_AUTH_SOURCE: Optional[str] = None
    MONGODB_RETRY_WRITES: bool = True
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    REDIS_PASSWORD: Optional[str] = None
    
    # JWT
    JWT_SECRET: str = "your-secret-key-here-change-in-production"
    ENABLE_AI_STUBS: bool = False
    COOKIE_SECURE: bool = False
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # Security
    OTP_EXPIRY_MINUTES: int = 5
    PASSWORD_RESET_EXPIRY_HOURS: int = 24
    
    # Email
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    EMAIL_FROM: str = "noreply@agriconnect.ai"
    
    # Payment Gateways
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_PUBLISHABLE_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    RAZORPAY_KEY_ID: Optional[str] = None
    RAZORPAY_KEY_SECRET: Optional[str] = None
    RAZORPAY_WEBHOOK_SECRET: Optional[str] = None

    # RazorpayX Payouts (farmer/delivery withdrawals)
    # Enable real payouts with RAZORPAY_PAYOUTS_ENABLED=True. When disabled the
    # backend simulates a successful transfer (development mode).
    RAZORPAY_PAYOUTS_ENABLED: bool = False
    RAZORPAY_PAYOUT_MODE: str = "IMPS"  # IMPS, NEFT, RTGS or UPI
    RAZORPAY_PAYOUT_NARRATION: str = "AgriConnect farmer payout"
    # Optional settlement account id from which payouts are debited.
    RAZORPAY_PAYOUT_ACCOUNT_ID: Optional[str] = None

    # COD cash-settlement controls
    # ------------------------------
    # How long a delivery partner has to remit collected COD cash before it
    # counts as overdue (hours). After this the partner is blocked from new
    # COD assignments until they settle.
    COD_SETTLEMENT_DUE_HOURS: int = 24
    # Max outstanding COD cash a partner may hold before new COD deliveries
    # are blocked. Reduces cash-handling risk.
    COD_MAX_OUTSTANDING: float = 10000.0
    # Delivery partner commission on COD (kept as their fee on top of the
    # order's deliveryCharge? No - the fee is order.deliveryCharge; this is the
    # additional percentage earned for handling the COD payment).
    COD_PARTNER_COMMISSION_RATE: float = 0.10
    COD_FARMER_COMMISSION_RATE: float = 0.85
    # Farm-pickup commission (percentage of the order settlement the platform
    # keeps). Unlike home-delivery orders the customer is NOT charged this on
    # top — it is deducted from the farmer's settlement. Cash-on-pickup
    # commissions become an outstanding debt that gets recovered from the
    # farmer's future online sale earnings (Option A).
    PICKUP_COMMISSION_RATE: float = 0.05
    # When a user withdraws to a different bank account than their most recent
    # withdrawal within this window (hours), the withdrawal is blocked until the
    # cooldown passes. Anti-fraud measure against account takeovers.
    WITHDRAWAL_BANK_COOLDOWN_HOURS: int = 48
    # Audit logs expire after this many days (privacy + storage hygiene).
    AUDIT_LOG_RETENTION_DAYS: int = 180
    # Max active sessions a user may hold before new logins revoke the oldest.
    MAX_ACTIVE_SESSIONS: int = 10
    # Collection account the delivery partner pays into when settling COD cash.
    COD_COLLECTION_UPI_ID: str = "agriconnect@bank"
    COD_COLLECTION_ACCOUNT_NUMBER: str = "XXXXXXXXXX"
    COD_COLLECTION_ACCOUNT_NAME: str = "AgriConnect Finance"
    COD_COLLECTION_ACCOUNT_IFSC: str = "XXXX0000000"
    
    # Cloud Storage
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_STORAGE_BUCKET_NAME: str = "agriconnect"
    AWS_REGION: str = "ap-south-1"
    
    # Google Maps
    GOOGLE_MAPS_API_KEY: Optional[str] = None
    
    # Twilio SMS
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_PHONE_NUMBER: Optional[str] = None

    # Vonage SMS
    VONAGE_API_KEY: Optional[str] = None
    VONAGE_API_SECRET: Optional[str] = None
    VONAGE_FROM: Optional[str] = None

    # MSG91 SMS (reliable for Indian numbers; preferred SMS provider)
    MSG91_AUTH_KEY: Optional[str] = None
    MSG91_SENDER_ID: Optional[str] = None
    MSG91_ROUTE: str = "4"
    MSG91_COUNTRY: str = "91"

    # WhatsApp Cloud API (Meta) - free tier: 1,000 service conversations/month.
    # Used as the primary delivery channel; SMS providers are the fallback.
    WHATSAPP_ACCESS_TOKEN: Optional[str] = None
    WHATSAPP_PHONE_NUMBER_ID: Optional[str] = None
    # Optional approved template for business-initiated messages. When set, the
    # whole SMS text is sent as the template's single body parameter. Text
    # messages only work inside a 24h customer-service window.
    WHATSAPP_TEMPLATE_NAME: Optional[str] = None
    WHATSAPP_TEMPLATE_LANGUAGE: str = "en_US"
    WHATSAPP_GRAPH_VERSION: str = "v20.0"

    # Email-to-SMS Gateway (send SMS via carrier email gateway, e.g., airtelap.com, ims.jio.com)
    SMS_EMAIL_GATEWAY_DOMAIN: Optional[str] = None

    # Public base URL used to build the one-tap rating link sent in delivery SMS.
    # In production set this to your public API/domain, e.g. https://api.agriconnect.ai
    PUBLIC_BASE_URL: str = "http://localhost:8000"
    
    # Firebase
    FIREBASE_SERVER_KEY: Optional[str] = None
    FIREBASE_SENDER_ID: Optional[str] = None
    
    # AI Services
    AI_MODEL_PATH: str = "./ai/models"
    DEMAND_PREDICTION_ENABLED: bool = True
    PRICE_OPTIMIZATION_ENABLED: bool = True
    ROUTE_OPTIMIZATION_ENABLED: bool = True
    
    # Celery
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"
    
    # File Uploads
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE_MB: int = 5

    # Rate Limiting
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_PER_HOUR: int = 1000
    
    # Monitoring
    SENTRY_DSN: Optional[str] = None
    
    @validator("RAZORPAY_PAYOUTS_ENABLED", pre=True)
    def parse_payouts_flag(cls, v):
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in {"1", "true", "yes", "on"}
        return v

    @validator("BACKEND_CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v: str | List[str]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    @validator("DEBUG", pre=True)
    def parse_debug_flag(cls, v):
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            normalized = v.strip().lower()
            if normalized in {"1", "true", "yes", "on", "dev", "development"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", "production", "prod"}:
                return False
        return v
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"

settings = Settings()
