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

            if role == "farmer":
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
                    "managerId": user_id,
                    "name": f"Warehouse of {first_name}",
                    "warehouseName": f"Warehouse of {first_name}",
                    "location": {},
                    "address": {},
                    "totalCapacity": 0,
                    "coldStorageCapacity": 0,
                    "usedCapacity": 0,
                    "coldStorageUsed": 0,
                    "isActive": True,
                    "isVerified": False,
                    "deletedAt": None,
                })
        except Exception:
            # Avoid leaving a half-created account behind if the role profile fails.
            await user_repository.delete_user(user_id)
            raise
        
        return user
    
    @staticmethod
    @staticmethod
    async def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
        """Authenticate by email, username, or phone, including local hub manager accounts."""
        identifier = (username or "").strip()
        if not identifier or not password:
            return None

        normalized = identifier.lower()
        candidates = []
        # Search email and username independently. This also supports legacy hub
        # records where the identifier was stored with inconsistent casing.
        if "@" in identifier:
            candidates.append({"email": normalized, "deletedAt": None})
            candidates.append({"username": normalized, "deletedAt": None})
        else:
            candidates.append({"username": normalized, "deletedAt": None})
            candidates.append({"email": normalized, "deletedAt": None})
            try:
                phone = normalize_phone_number(identifier)
                candidates.append({"phone": phone, "deletedAt": None})
            except ValueError:
                pass

        seen_ids = set()
        for query in candidates:
            user = await user_repository.find_one(query)
            if not user:
                continue
            user_id = str(user.get("_id") or "")
            if user_id and user_id in seen_ids:
                continue
            if user_id:
                seen_ids.add(user_id)
            password_hash = user.get("passwordHash") or user.get("password_hash") or ""
            if password_hash:
                try:
                    if Security.verify_password(password, password_hash):
                        if user.get("isActive", True) is False or user.get("status") in ("suspended", "disabled", "inactive"):
                            return None
                        return user
                except (ValueError, TypeError):
                    continue
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
