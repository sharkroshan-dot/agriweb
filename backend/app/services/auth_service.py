from typing import Optional, Dict, Any
from datetime import datetime
from app.core.security import Security, SELF_REGISTRATION_ROLES
from app.repositories.user_repository import user_repository
from app.database.redis import RedisClient
from app.utils.helpers import normalize_phone_number
import logging

logger = logging.getLogger(__name__)

class AuthService:
    """Authentication service."""

    @staticmethod
    def _normalize_registration_data(user_data: Dict[str, Any]) -> Dict[str, Any]:
        """Convert incoming registration payload into the canonical user document shape."""
        normalized_data = dict(user_data)

        first_name = normalized_data.pop("first_name", normalized_data.pop("firstName", ""))
        last_name = normalized_data.pop("last_name", normalized_data.pop("lastName", ""))

        normalized_data["email"] = normalized_data["email"].strip().lower()
        normalized_data["phone"] = normalized_data["phone"].strip()
        role = normalized_data.get("role", "customer").strip().lower()
        if role not in SELF_REGISTRATION_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(sorted(SELF_REGISTRATION_ROLES))}")
        normalized_data["role"] = role
        normalized_data["firstName"] = first_name.strip()
        normalized_data["lastName"] = last_name.strip()

        if role == "business":
            required = ("businessName", "businessType", "businessAddress", "businessCity", "businessState", "contactPerson")
            missing = [field for field in required if not str(normalized_data.get(field) or "").strip()]
            if missing:
                raise ValueError("Business registration requires: " + ", ".join(missing))
            if normalized_data.get("gstin"):
                normalized_data["gstin"] = str(normalized_data["gstin"]).strip().upper()

        return normalized_data
    
    @staticmethod
    async def register_user(user_data: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new user."""
        normalized_data = AuthService._normalize_registration_data(user_data)
        raw_password = normalized_data.pop("password")
        normalized_data["passwordHash"] = Security.get_password_hash(raw_password)
        normalized_data["isVerified"] = False
        normalized_data["isActive"] = True

        # Create user using the repository helper so email normalization stays consistent.
        user_id = await user_repository.create_user(normalized_data)
        if not user_id:
            raise RuntimeError("Failed to create user")

        user = await user_repository.get_by_id(user_id)

        # Create role-specific profile
        try:
            role = normalized_data.get("role", "customer")
            first_name = normalized_data.get("firstName", "")

            if role == "business":
                from app.repositories.base_repository import BaseRepository
                business_profile_repo = BaseRepository("business_profiles")
                sensitive = {
                    "gstin": Security.encrypt_business_data(normalized_data.get("gstin")),
                    "businessAddress": Security.encrypt_business_data(normalized_data.get("businessAddress")),
                    "contactPerson": Security.encrypt_business_data(normalized_data.get("contactPerson")),
                    "procurementRequirements": Security.encrypt_business_data(normalized_data.get("procurementRequirements")),
                }
                await business_profile_repo.create({
                    "userId": user_id,
                    "businessName": normalized_data.get("businessName"),
                    "businessType": normalized_data.get("businessType"),
                    "gstinEncrypted": sensitive["gstin"],
                    "businessAddressEncrypted": sensitive["businessAddress"],
                    "contactPersonEncrypted": sensitive["contactPerson"],
                    "procurementRequirementsEncrypted": sensitive["procurementRequirements"],
                    "city": normalized_data.get("businessCity"),
                    "state": normalized_data.get("businessState"),
                    "district": normalized_data.get("businessDistrict"),
                    "phone": normalized_data.get("phone"),
                    "isVerified": False,
                    "verificationStatus": "pending",
                    "createdAt": datetime.utcnow(),
                    "updatedAt": datetime.utcnow(),
                })
            elif role == "farmer":
                from app.repositories.farmer_repository import farmer_repository
                await farmer_repository.create({
                    "userId": user_id,
                    "farmName": normalized_data.get("farmName", f"Farm of {first_name}"),
                    "isVerified": False
                })
            elif role == "delivery":
                from app.repositories.delivery_repository import delivery_repository
                await delivery_repository.create({
                    "userId": user_id,
                    "vehicleType": normalized_data.get("vehicleType", "bike"),
                    "vehicleNumber": normalized_data.get("vehicleNumber", "TEMP"),
                    "vehicleModel": normalized_data.get("vehicleModel"),
                    "vehicleYear": normalized_data.get("vehicleYear"),
                    "capacity": normalized_data.get("capacity"),
                    "fuelType": normalized_data.get("fuelType"),
                    "isVerified": False
                })
            elif role == "warehouse":
                from app.repositories.warehouse_repository import warehouse_repository
                await warehouse_repository.create({
                    "userId": user_id,
                    "warehouseName": f"Warehouse of {first_name}",
                    "isVerified": False
                })
        except Exception:
            # Avoid leaving a half-created account behind if the role profile fails.
            await user_repository.delete_user(user_id)
            raise
        
        return user
    
    @staticmethod
    async def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
        """Authenticate user by email or phone with canonicalized identifiers."""
        identifier = (username or "").strip()
        if not identifier:
            return None

        candidates = []
        if "@" in identifier:
            candidates.append(identifier.lower())
        else:
            try:
                candidates.append(normalize_phone_number(identifier))
            except ValueError:
                candidates.append(identifier)
            candidates.append(identifier.lower())

        seen = set()
        for candidate in candidates:
            key = candidate.lower() if isinstance(candidate, str) else str(candidate)
            if key in seen:
                continue
            seen.add(key)

            user = await user_repository.get_by_email(candidate) if "@" in key else None
            if not user:
                try:
                    user = await user_repository.get_by_phone(candidate)
                except Exception:
                    user = None

            if user and Security.verify_password(password, user.get("passwordHash", "")):
                return user

        return None
    
    @staticmethod
    async def verify_user(user_id: str, otp: str) -> bool:
        """Verify user with OTP."""
        user = await user_repository.get_by_id(user_id)
        if not user:
            return False
        
        # Get OTP from cache
        phone = user.get("phone")
        cached_data = await RedisClient.get_cache(f"otp:{phone}")
        if not cached_data or not Security.verify_otp(otp, cached_data.get("otp_hash", "")):
            return False
        
        # Mark as verified
        await user_repository.update(
            {"_id": user["_id"]},
            {"isVerified": True, "verifiedAt": datetime.utcnow()}
        )
        
        # Delete OTP
        await RedisClient.delete_cache(f"otp:{phone}")
        
        return True
