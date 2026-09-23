from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime
from enum import Enum

class DeliveryDocumentType(str, Enum):
    AADHAAR = "aadhaar"
    PAN = "pan"
    DRIVING_LICENSE = "driving_license"
    VEHICLE_REGISTRATION = "vehicle_registration"
    BANK_PASSBOOK = "bank_passbook"
    PROFILE_PHOTO = "profile_photo"

class DeliveryKYCStatus(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    VERIFIED = "verified"
    REJECTED = "rejected"

class DeliveryDocument(BaseModel):
    type: DeliveryDocumentType
    documentNumber: Optional[str] = None
    imageUrl: str
    expiryDate: Optional[str] = Field(None, description="ISO date (YYYY-MM-DD) when the document expires")

class DeliveryBankAccount(BaseModel):
    accountHolderName: str
    accountNumber: str
    ifscCode: str
    bankName: Optional[str] = None
    status: str = "pending"

class DeliveryKYCSubmission(BaseModel):
    """KYC submission for a delivery partner."""
    fullName: str
    phone: str = Field(..., description="Phone number with country code (E.164)")
    address: Optional[str] = None
    emergencyContactName: Optional[str] = None
    emergencyContactPhone: Optional[str] = None
    vehicleType: Optional[str] = None
    vehicleNumber: Optional[str] = None
    drivingLicenseNumber: Optional[str] = None
    drivingLicenseExpiry: Optional[str] = None
    documents: List[DeliveryDocument] = Field(default_factory=list)
    bankAccount: Optional[DeliveryBankAccount] = None

    @validator('phone')
    def validate_phone(cls, v):
        from app.utils.helpers import normalize_phone_number
        return normalize_phone_number(v)

class DeliveryKYCResponse(BaseModel):
    id: str
    userId: str
    fullName: str
    phone: str
    address: Optional[str] = None
    emergencyContactName: Optional[str] = None
    emergencyContactPhone: Optional[str] = None
    vehicleType: Optional[str] = None
    vehicleNumber: Optional[str] = None
    drivingLicenseNumber: Optional[str] = None
    drivingLicenseExpiry: Optional[str] = None
    documents: List[DeliveryDocument]
    bankAccount: Optional[DeliveryBankAccount] = None
    status: DeliveryKYCStatus
    adminRemark: Optional[str] = None
    submittedAt: datetime
    verifiedAt: Optional[datetime] = None
    updatedAt: datetime