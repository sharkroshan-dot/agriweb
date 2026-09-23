from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional
from app.api.v1.auth import get_current_user
from app.schemas.user import (
    UserResponse, UserUpdate, UserProfileResponse,
    AddressResponse, AddressCreate, AddressUpdate,
    ChangePasswordRequest
)
from app.services.user_service import UserService
from app.services.auth_service import AuthService
from app.services.order_service import _convert_objectids
from app.repositories.user_repository import user_repository
from app.core.security import Security
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


async def _geocode_address_data(address_data) -> Optional[dict]:
    """Geocode a manually-typed address so every saved address carries real
    coordinates (street-level via Nominatim/Photon, city-centre as fallback).
    Returns None if the address cannot be resolved; the caller saves it without
    coordinates and on-the-fly geocoding still runs at fee-estimate time."""
    from app.services.order_service import geocode_address
    try:
        return await geocode_address({
            "address_line1": address_data.address_line1,
            "address_line2": address_data.address_line2 or "",
            "city": address_data.city,
            "state": address_data.state,
            "zip_code": address_data.zip_code,
            "country": address_data.country,
        })
    except Exception as e:
        logger.warning("Address geocoding failed: %s", e)
        return None

@router.get("/me", response_model=UserProfileResponse)
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    """
    Get current user's complete profile.
    
    Returns user details, role-specific profile, addresses, and stats.
    """
    user_id = str(current_user["_id"])
    profile = await UserService.get_user_profile(user_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    profile = _convert_objectids(profile)
    
    return profile

@router.put("/me", response_model=UserResponse)
async def update_my_profile(
    update_data: UserUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update current user's profile.
    
    - **firstName**: Updated first name
    - **lastName**: Updated last name
    - **avatarUrl**: Updated avatar URL
    - **phone**: Updated phone number
    """
    user_id = str(current_user["_id"])
    
    # If updating phone, check if it's already taken
    if update_data.phone:
        existing_user = await UserService.get_user_by_phone(update_data.phone)
        if existing_user and str(existing_user["_id"]) != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Phone number already in use"
            )
    
    updated_user = await UserService.update_user(user_id, update_data)
    if not updated_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return updated_user

@router.post("/me/change-password")
async def change_password(
    request: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Change user's password.
    
    - **currentPassword**: Current password
    - **newPassword**: New password (must meet strength requirements)
    """
    user_id = str(current_user["_id"])
    
    success = await UserService.change_password(
        user_id,
        request.currentPassword,
        request.newPassword
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    return {
        "success": True,
        "message": "Password changed successfully"
    }

@router.post("/me/avatar")
async def upload_avatar(
    # avatar: UploadFile = File(...),  # Would handle file upload
    current_user: dict = Depends(get_current_user)
):
    """
    Upload user avatar.
    
    Currently returns a placeholder. In production, this would handle
    file upload to S3/Cloudinary and return the URL.
    """
    # TODO: Implement file upload
    # For now, return a placeholder
    return {
        "success": True,
        "data": {
            "avatarUrl": "https://storage.agriconnect.ai/avatars/default.jpg"
        },
        "message": "Avatar upload functionality will be implemented with S3 integration"
    }

# Address Management
@router.get("/me/addresses", response_model=List[AddressResponse])
async def get_my_addresses(current_user: dict = Depends(get_current_user)):
    """Get all addresses for the current user."""
    user_id = str(current_user["_id"])
    addresses = await UserService.get_addresses(user_id)
    
    # Convert ObjectId to string for response
    for address in addresses:
        address["id"] = str(address["_id"])
        address["user_id"] = str(address["userId"])
        address["created_at"] = address["createdAt"]
        address["updated_at"] = address["updatedAt"]
    
    return addresses

@router.post("/me/addresses", response_model=AddressResponse, status_code=status.HTTP_201_CREATED)
async def create_address(
    address_data: AddressCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new address for the current user.
    
    - **addressLine1**: Street address
    - **addressLine2**: Apartment, suite, etc. (optional)
    - **city**: City name
    - **state**: State name
    - **zipCode**: Postal code
    - **country**: Country name (default: India)
    - **addressType**: home, work, farm, warehouse, other
    - **isDefault**: Set as default address
    - **location**: GeoJSON point {type: "Point", coordinates: [lng, lat]}
    """
    user_id = str(current_user["_id"])
    
    # Validate location if provided
    if address_data.location:
        if not isinstance(address_data.location, dict) or \
           address_data.location.get("type") != "Point" or \
           not address_data.location.get("coordinates"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid location format. Must be GeoJSON Point"
            )
    
    if not address_data.location:
        address_data.location = await _geocode_address_data(address_data)
    
    try:
        address = await UserService.create_address(user_id, address_data)
    except Exception as e:
        logger.error(f"Failed to create address for user {user_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
    if not address:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create address"
        )
    
    address["id"] = str(address["_id"])
    address["user_id"] = str(address["userId"])
    address["created_at"] = address["createdAt"]
    address["updated_at"] = address["updatedAt"]
    
    return address

@router.put("/me/addresses/{address_id}", response_model=AddressResponse)
async def update_address(
    address_id: str,
    address_data: AddressUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update an existing address.
    """
    user_id = str(current_user["_id"])
    
    if not address_data.location:
        address_data.location = await _geocode_address_data(address_data)
    
    address = await UserService.update_address(user_id, address_id, address_data)
    if not address:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Address not found"
        )
    
    address["id"] = str(address["_id"])
    address["user_id"] = str(address["userId"])
    address["created_at"] = address["createdAt"]
    address["updated_at"] = address["updatedAt"]
    
    return address

@router.delete("/me/addresses/{address_id}")
async def delete_address(
    address_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Delete an address.
    """
    user_id = str(current_user["_id"])
    
    success = await UserService.delete_address(user_id, address_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Address not found"
        )
    
    return {
        "success": True,
        "message": "Address deleted successfully"
    }

@router.put("/me/addresses/{address_id}/default")
async def set_default_address(
    address_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Set an address as default.
    """
    user_id = str(current_user["_id"])
    
    success = await UserService.set_default_address(user_id, address_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Address not found"
        )
    
    return {
        "success": True,
        "message": "Default address updated successfully"
    }

@router.put("/me/addresses/{address_id}/permanent")
async def set_permanent_address(
    address_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Set an address as the permanent address.
    """
    user_id = str(current_user["_id"])
    
    success = await UserService.set_permanent_address(user_id, address_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Address not found"
        )
    
    return {
        "success": True,
        "message": "Permanent address updated successfully"
    }

# Admin endpoints
@router.get("/", response_model=List[UserResponse])
async def get_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    role: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get users (Admin only).
    
    - **skip**: Number of users to skip (pagination)
    - **limit**: Number of users to return
    - **role**: Filter by role (customer, farmer, delivery, warehouse, admin)
    - **search**: Search by name, email, or phone
    """
    # Check if admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    
    if search:
        users = await UserService.search_users(search, skip, limit)
    elif role:
        users = await UserService.get_users_by_role(role, skip, limit)
    else:
        users = await user_repository.get_active_users(skip, limit)

    from app.api.v1.auth import _build_user_response
    return [_build_user_response(user) for user in users]

@router.get("/{user_id}", response_model=UserProfileResponse)
async def get_user_profile(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get user profile by ID (Admin only).
    """
    # Check if admin or viewing own profile
    if current_user.get("role") != "admin" and str(current_user["_id"]) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own profile"
        )
    
    profile = await UserService.get_user_profile(user_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return profile

@router.put("/{user_id}/suspend")
async def suspend_user(
    user_id: str,
    reason: str = Query(..., description="Reason for suspension"),
    current_user: dict = Depends(get_current_user)
):
    """
    Suspend a user account (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can suspend users"
        )
    
    success = await UserService.suspend_user(user_id, reason)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return {
        "success": True,
        "message": "User suspended successfully"
    }

@router.put("/{user_id}/activate")
async def activate_user(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Activate a suspended user account (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can activate users"
        )
    
    success = await UserService.activate_user(user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return {
        "success": True,
        "message": "User activated successfully"
    }

@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a user account (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can delete users"
        )
    
    success = await UserService.delete_user(user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return {
        "success": True,
        "message": "User deleted successfully"
    }
