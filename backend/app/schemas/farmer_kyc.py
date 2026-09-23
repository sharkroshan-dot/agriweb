from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class KYCDocumentType(str, Enum):
    AADHAAR = "aadhaar"
    PAN = "pan"
    BANK_PASSBOOK = "bank_passbook"
    LAND_DOCUMENT = "land_document"
    LAND_VIDEO = "land_video"
    FARM_PHOTO = "farm_photo"

class KYCStatus(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    VERIFIED = "verified"
    REJECTED = "rejected"

class KYCDocument(BaseModel):
    type: KYCDocumentType
    documentNumber: Optional[str] = None
    imageUrl: str
    # Optional expiry tracking so the platform can flag documents that lapse.
    expiryDate: Optional[str] = Field(None, description="ISO date (YYYY-MM-DD) when the document expires")

class BankAccountDetails(BaseModel):
    """Bank account used for farmer payouts."""
    accountHolderName: str
    accountNumber: str
    ifscCode: str
    bankName: Optional[str] = None
    # 'verified' is set by an admin after micro-deposit / account validation.
    status: str = "pending"

class KYCSubmission(BaseModel):
    farmName: str
    farmAddress: str
    farmCity: str
    farmState: str
    farmPincode: str
    farmSizeAcres: float
    documents: List[KYCDocument]
    bankAccount: Optional[BankAccountDetails] = None

class KYCUpdateSubmission(BaseModel):
    """Partial update used by the per-step verification sections (mobile/identity/farm/bank).

    Only the fields provided by the caller are merged onto the farmer's existing
    KYC record, so each verification step can be completed independently.
    """
    farmName: Optional[str] = None
    farmAddress: Optional[str] = None
    farmCity: Optional[str] = None
    farmState: Optional[str] = None
    farmPincode: Optional[str] = None
    farmSizeAcres: Optional[float] = None
    documents: Optional[List[KYCDocument]] = None
    bankAccount: Optional[BankAccountDetails] = None

class KYCResponse(BaseModel):
    id: str
    userId: str
    farmName: str
    farmAddress: str
    farmCity: str
    farmState: str
    farmPincode: str
    farmSizeAcres: float
    documents: List[KYCDocument]
    bankAccount: Optional[BankAccountDetails] = None
    status: KYCStatus
    adminRemark: Optional[str] = None
    submittedAt: datetime
    verifiedAt: Optional[datetime] = None
    updatedAt: datetime