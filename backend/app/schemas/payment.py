from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SUCCESS = "success"
    FAILED = "failed"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"

class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"
    UPI = "upi"
    WALLET = "wallet"
    RAZORPAY = "razorpay"
    STRIPE = "stripe"

class PaymentGateway(str, Enum):
    STRIPE = "stripe"
    RAZORPAY = "razorpay"
    CASH = "cash"

class WalletTransactionType(str, Enum):
    CREDIT = "credit"
    DEBIT = "debit"

class WalletTransactionStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"

# Payment Intent Schemas
class PaymentIntentCreate(BaseModel):
    orderId: str
    amount: float = Field(gt=0)
    currency: str = "INR"
    paymentMethod: PaymentMethod
    description: Optional[str] = None
    customerId: str
    customerEmail: str
    customerName: str

class PaymentIntentResponse(BaseModel):
    id: str
    clientSecret: Optional[str] = None
    orderId: str
    amount: float
    currency: str
    status: PaymentStatus
    paymentMethod: PaymentMethod
    gateway: PaymentGateway
    gatewayTransactionId: Optional[str] = None
    createdAt: datetime

# Payment Confirmation
class PaymentConfirm(BaseModel):
    paymentIntentId: str
    orderId: str
    paymentMethod: Optional[PaymentMethod] = None
    gatewayResponse: Optional[Dict[str, Any]] = None

class PaymentResponse(BaseModel):
    id: str
    orderId: str
    userId: str
    amount: float
    currency: str
    paymentMethod: PaymentMethod
    status: PaymentStatus
    transactionId: Optional[str] = None
    gatewayResponse: Optional[Dict[str, Any]] = None
    refundAmount: Optional[float] = None
    refundId: Optional[str] = None
    paymentDate: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime
    
    class Config:
        from_attributes = True

# Refund Request
class RefundRequest(BaseModel):
    orderId: str
    amount: Optional[float] = None  # If None, full refund
    reason: str
    refundMethod: Optional[str] = None

class RefundResponse(BaseModel):
    id: str
    orderId: str
    amount: float
    status: str
    transactionId: Optional[str] = None
    processedAt: Optional[datetime] = None

# Wallet Schemas
class WalletCreate(BaseModel):
    userId: str
    currency: str = "INR"

class WalletResponse(BaseModel):
    id: str
    userId: str
    balance: float
    currency: str
    isActive: bool
    createdAt: datetime
    updatedAt: datetime

class WalletTransactionCreate(BaseModel):
    walletId: str
    userId: str
    amount: float = Field(gt=0)
    type: WalletTransactionType
    description: str
    referenceId: Optional[str] = None
    referenceType: Optional[str] = None

class WalletTransactionResponse(BaseModel):
    id: str
    walletId: str
    userId: str
    amount: float
    type: WalletTransactionType
    description: str
    referenceId: Optional[str] = None
    referenceType: Optional[str] = None
    balanceAfter: float
    status: WalletTransactionStatus
    createdAt: datetime

class WalletAddFunds(BaseModel):
    amount: float = Field(gt=0, le=100000)
    paymentMethod: PaymentMethod
    successUrl: Optional[str] = None
    cancelUrl: Optional[str] = None

class WalletWithdraw(BaseModel):
    amount: float = Field(gt=0)
    bankAccount: Dict[str, Any]

# Payment Split Schemas
class PaymentSplitCreate(BaseModel):
    paymentId: str
    orderId: str
    splits: List[Dict[str, Any]]

class PaymentSplitResponse(BaseModel):
    id: str
    paymentId: str
    orderId: str
    splits: List[Dict[str, Any]]
    status: str
    createdAt: datetime
    updatedAt: datetime

# Webhook Schemas
class WebhookPayload(BaseModel):
    event: str
    data: Dict[str, Any]
    timestamp: datetime
    signature: Optional[str] = None
