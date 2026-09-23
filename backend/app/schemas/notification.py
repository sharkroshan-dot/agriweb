from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class NotificationType(str, Enum):
    ORDER = "order"
    DELIVERY = "delivery"
    PAYMENT = "payment"
    PROMOTION = "promotion"
    SYSTEM = "system"
    CHAT = "chat"
    WAREHOUSE = "warehouse"
    FARMER = "farmer"
    CUSTOMER = "customer"
    ADMIN = "admin"
    SECURITY = "security"


class NotificationPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class NotificationChannel(str, Enum):
    PUSH = "push"
    EMAIL = "email"
    SMS = "sms"
    IN_APP = "in_app"


class NotificationStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    FAILED = "failed"


class NotificationBase(BaseModel):
    userId: str
    type: NotificationType
    title: str
    message: str
    data: Optional[Dict[str, Any]] = None
    priority: NotificationPriority = NotificationPriority.MEDIUM
    channels: List[NotificationChannel] = [NotificationChannel.IN_APP]


class NotificationCreate(NotificationBase):
    pass


class NotificationUpdate(BaseModel):
    isRead: Optional[bool] = None
    status: Optional[NotificationStatus] = None
    readAt: Optional[datetime] = None


class NotificationResponse(NotificationBase):
    id: str
    isRead: bool
    readAt: Optional[datetime] = None
    status: NotificationStatus
    sentAt: Optional[datetime] = None
    deliveredAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class DeviceTokenBase(BaseModel):
    userId: str
    deviceToken: str
    platform: str
    deviceId: Optional[str] = None
    appVersion: Optional[str] = None


class DeviceTokenCreate(DeviceTokenBase):
    pass


class DeviceTokenUpdate(BaseModel):
    isActive: Optional[bool] = None
    appVersion: Optional[str] = None


class DeviceTokenResponse(DeviceTokenBase):
    id: str
    isActive: bool
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class EmailBase(BaseModel):
    to: str
    subject: str
    body: str
    template: Optional[str] = None
    templateData: Optional[Dict[str, Any]] = None
    attachments: Optional[List[Dict[str, Any]]] = None


class EmailCreate(EmailBase):
    pass


class EmailResponse(EmailBase):
    id: str
    status: str
    error: Optional[str] = None
    sentAt: Optional[datetime] = None
    createdAt: datetime

    class Config:
        from_attributes = True


class SMSBase(BaseModel):
    to: str
    message: str
    template: Optional[str] = None
    templateData: Optional[Dict[str, Any]] = None


class SMSCreate(SMSBase):
    pass


class SMSResponse(SMSBase):
    id: str
    status: str
    error: Optional[str] = None
    sentAt: Optional[datetime] = None
    createdAt: datetime

    class Config:
        from_attributes = True


class PushNotificationBase(BaseModel):
    userId: str
    title: str
    body: str
    data: Optional[Dict[str, Any]] = None
    image: Optional[str] = None
    sound: Optional[str] = None
    badge: Optional[int] = None


class PushNotificationCreate(PushNotificationBase):
    pass


class PushNotificationResponse(PushNotificationBase):
    id: str
    status: str
    sentAt: Optional[datetime] = None
    deliveredAt: Optional[datetime] = None
    createdAt: datetime

    class Config:
        from_attributes = True


class NotificationPreferencesBase(BaseModel):
    userId: str
    preferences: Dict[str, bool]


class NotificationPreferencesCreate(NotificationPreferencesBase):
    pass


class NotificationPreferencesUpdate(BaseModel):
    preferences: Dict[str, bool]


class NotificationPreferencesResponse(NotificationPreferencesBase):
    id: str
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class NotificationStatsResponse(BaseModel):
    total: int
    unread: int
    read: int
    byType: Dict[str, int]
    byPriority: Dict[str, int]
    recent: List[NotificationResponse]
