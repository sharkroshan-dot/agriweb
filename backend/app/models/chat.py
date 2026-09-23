from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

CONVERSATION_CUSTOMER = "customer"
CONVERSATION_DELIVERY = "delivery"
CONVERSATION_B2B = "b2b"
CONVERSATION_SUPPORT = "support"

class Message(BaseModel):
    id: str = Field(default="")
    conversation_id: str = Field(default="")
    sender_id: str = Field(default="")
    sender_name: str = Field(default="")
    sender_role: str = Field(default="")
    content: str = Field(default="")
    message_type: str = Field(default="text")
    action: Optional[str] = None
    attachments: list[dict] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    read_at: Optional[datetime] = None

class Conversation(BaseModel):
    id: str = Field(default="")
    conversation_type: str = Field(default=CONVERSATION_CUSTOMER)
    participants: list[dict] = Field(default_factory=list)
    subject: str = Field(default="")
    order_id: Optional[str] = None
    order_number: Optional[str] = None
    rfq_id: Optional[str] = None
    rfq_number: Optional[str] = None
    quick_actions: list[dict] = Field(default_factory=list)
    last_message: Optional[Message] = None
    unread_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = Field(default="active")
