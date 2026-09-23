from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import HTMLResponse
from typing import List, Optional, Dict
from pydantic import BaseModel, Field
from bson import ObjectId
from datetime import datetime
from app.api.v1.auth import get_current_user
from app.schemas.notification import (
    NotificationResponse,
    NotificationUpdate,
    NotificationPreferencesResponse,
    NotificationPreferencesUpdate,
    DeviceTokenResponse,
    DeviceTokenCreate,
    NotificationStatsResponse,
    NotificationType,
    NotificationPriority
)
from app.services.notification_service import NotificationService, _json_safe
from app.services.sms_rating_service import SMSRatingService
from app.repositories.notification_repository import notification_repository
from app.repositories.device_token_repository import device_token_repository
from app.repositories.notification_preferences_repository import notification_preferences_repository
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

class DeliveryPartnerRatingSubmit(BaseModel):
    overallRating: int = Field(ge=1, le=5)
    onTimeRating: Optional[int] = Field(None, ge=1, le=5)
    professionalismRating: Optional[int] = Field(None, ge=1, le=5)
    handlingRating: Optional[int] = Field(None, ge=1, le=5)
    communicationRating: Optional[int] = Field(None, ge=1, le=5)
    feedback: Optional[str] = Field(None, max_length=2000)

class RatingSubmit(BaseModel):
    ratings: Dict[str, int] = Field(default_factory=dict)
    deliveryPartner: Optional[DeliveryPartnerRatingSubmit] = None

@router.get("/rate/{token}", response_class=HTMLResponse)
async def rating_page(token: str):
    """Public rating page opened from the delivery SMS link (no login needed)."""
    context = await SMSRatingService.get_rating_context(token)
    if not context:
        return HTMLResponse(content=SMSRatingService.render_invalid_page())
    if not context.get("products") and not context.get("deliveryPartner"):
        return HTMLResponse(content=SMSRatingService.render_done_page())
    return HTMLResponse(content=SMSRatingService.render_page(context))

@router.post("/rate/{token}")
async def submit_rating(token: str, data: RatingSubmit):
    """Accept ratings submitted from the public rating page."""
    result = await SMSRatingService.submit_ratings(
        token,
        data.ratings,
        delivery_rating=data.deliveryPartner.model_dump() if data.deliveryPartner else None
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("message", "Invalid or expired rating link")
        )
    return result

@router.get("/", response_model=dict)
async def get_my_notifications(
    is_read: Optional[bool] = Query(None),
    type: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    user_id = str(current_user["_id"])
    notification_type = NotificationType(type) if type else None
    result = await NotificationService.get_user_notifications(
        user_id,
        is_read,
        notification_type,
        skip,
        limit
    )
    return {
        "success": True,
        "data": result
    }

@router.get("/unread/count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    count = await NotificationService.get_unread_count(user_id)
    return {
        "success": True,
        "data": {"count": count}
    }

@router.get("/{notification_id}")
async def get_notification_detail(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Return one notification with all stored details for its owner."""
    user_id = str(current_user["_id"])
    notification = await notification_repository.get_by_id(notification_id)
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    if str(notification["userId"]) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this notification"
        )

    notification["id"] = str(notification["_id"])
    notification = _json_safe(notification)
    return {
        "success": True,
        "data": {"notification": notification}
    }


@router.put("/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    user_id = str(current_user["_id"])
    notification = await notification_repository.get_by_id(notification_id)
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    if str(notification["userId"]) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this notification"
        )
    success = await NotificationService.mark_notification_read(notification_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to mark notification as read"
        )
    return {
        "success": True,
        "message": "Notification marked as read"
    }

@router.put("/read-all")
async def mark_all_notifications_read(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    success = await NotificationService.mark_all_notifications_read(user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to mark notifications as read"
        )
    return {
        "success": True,
        "message": "All notifications marked as read"
    }

@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    user_id = str(current_user["_id"])
    notification = await notification_repository.get_by_id(notification_id)
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    if str(notification["userId"]) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to delete this notification"
        )
    success = await notification_repository.delete({"_id": notification["_id"]})
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to delete notification"
        )
    return {
        "success": True,
        "message": "Notification deleted"
    }

@router.post("/devices", response_model=DeviceTokenResponse)
async def register_device_token(
    data: DeviceTokenCreate,
    current_user: dict = Depends(get_current_user)
):
    user_id = str(current_user["_id"])
    existing = await device_token_repository.get_by_token(data.deviceToken)
    if existing:
        await device_token_repository.update(
            {"_id": existing["_id"]},
            {
                "userId": ObjectId(user_id),
                "isActive": True,
                "updatedAt": datetime.utcnow()
            }
        )
        token = await device_token_repository.get_by_id(str(existing["_id"]))
    else:
        token_data = data.dict()
        token_data["userId"] = ObjectId(user_id)
        token_id = await device_token_repository.create_token(token_data)
        if not token_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to register device token"
            )
        token = await device_token_repository.get_by_id(token_id)
    token["id"] = str(token["_id"])
    return token

@router.delete("/devices/{device_token}")
async def unregister_device_token(
    device_token: str,
    current_user: dict = Depends(get_current_user)
):
    token = await device_token_repository.get_by_token(device_token)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device token not found"
        )
    if str(token["userId"]) != str(current_user["_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to delete this token"
        )
    success = await device_token_repository.deactivate_token(device_token)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to unregister device token"
        )
    return {
        "success": True,
        "message": "Device token unregistered"
    }

@router.get("/preferences", response_model=NotificationPreferencesResponse)
async def get_my_preferences(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    preferences = await notification_preferences_repository.get_by_user_id(user_id)
    if not preferences:
        default_prefs = {
            "order": True,
            "delivery": True,
            "payment": True,
            "promotion": True,
            "system": True,
            "chat": True,
            "warehouse": True,
            "farmer": True,
            "customer": True,
            "admin": True,
            "security": True
        }
        prefs_data = {
            "userId": ObjectId(user_id),
            "preferences": default_prefs
        }
        prefs_id = await notification_preferences_repository.create_preferences(prefs_data)
        preferences = await notification_preferences_repository.get_by_id(prefs_id)
    preferences["id"] = str(preferences["_id"])
    return preferences

@router.put("/preferences", response_model=NotificationPreferencesResponse)
async def update_my_preferences(
    data: NotificationPreferencesUpdate,
    current_user: dict = Depends(get_current_user)
):
    user_id = str(current_user["_id"])
    success = await notification_preferences_repository.update_preferences(
        user_id,
        data.preferences
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update preferences"
        )
    preferences = await notification_preferences_repository.get_by_user_id(user_id)
    preferences["id"] = str(preferences["_id"])
    return preferences

@router.get("/stats", response_model=NotificationStatsResponse)
async def get_notification_stats(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    stats = await notification_repository.get_notification_stats(user_id)
    recent = await notification_repository.get_by_user_id(
        user_id,
        is_read=False,
        limit=5
    )
    for notif in recent:
        notif["id"] = str(notif["_id"])
    recent = [_json_safe(notif) for notif in recent]
    return {
        "total": stats.get("total", 0),
        "unread": stats.get("unread", 0),
        "read": stats.get("read", 0),
        "byType": stats.get("byType", {}),
        "byPriority": {},
        "recent": recent
    }

@router.get("/admin/all")
async def get_all_notifications(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    filter = {"deletedAt": None}
    if status:
        filter["status"] = status
    if user_id:
        filter["userId"] = ObjectId(user_id)
    skip = (page - 1) * limit
    notifications = await notification_repository.find_many(
        filter,
        skip=skip,
        limit=limit,
        sort=[("createdAt", -1)]
    )
    total = await notification_repository.count(filter)
    for notif in notifications:
        notif["id"] = str(notif["_id"])
    notifications = [_json_safe(notif) for notif in notifications]
    return {
        "success": True,
        "data": {
            "notifications": notifications,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/admin/send")
async def send_bulk_notification(
    user_ids: List[str],
    title: str,
    message: str,
    type: str = "system",
    priority: str = "medium",
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can send bulk notifications"
        )
    success_count = 0
    failed_count = 0
    for user_id in user_ids:
        try:
            notification = await NotificationService.create_in_app_notification(
                user_id,
                NotificationType(type),
                title,
                message,
                {"type": "bulk", "admin_id": str(current_user["_id"])},
                NotificationPriority(priority)
            )
            if notification:
                success_count += 1
            else:
                failed_count += 1
        except Exception as e:
            logger.error(f"Failed to send notification to {user_id}: {str(e)}")
            failed_count += 1
    return {
        "success": True,
        "data": {
            "total": len(user_ids),
            "successful": success_count,
            "failed": failed_count
        }
    }
