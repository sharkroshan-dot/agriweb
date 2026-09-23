from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class CropRecommendationRequest(BaseModel):
    soilType: str = "loamy"
    location: str
    temperature: float = 28.0
    rainfall: float = 100.0
    previousCrop: Optional[str] = None
    season: str = "kharif"
    areaAcres: float = 1.0

class CropRecommendationResponse(BaseModel):
    recommendations: List[dict]
    topCrop: str
    soilHealth: str
    seasonInfo: str
    timestamp: datetime

class ChatbotRequest(BaseModel):
    message: str
    language: str = "english"

class ChatbotResponse(BaseModel):
    reply: str
    language: str
    intent: str

class DiseaseDetectionRequest(BaseModel):
    imageUrl: str
    plantType: Optional[str] = None

class DiseaseDetectionResponse(BaseModel):
    diseaseName: str
    confidence: float
    description: str
    treatment: str
    prevention: str
    severity: str

class VoiceAssistantMessage(BaseModel):
    role: str
    content: str

class VoiceAssistantRequest(BaseModel):
    audioText: str
    language: str = "english"
    context: str = "general"
    conversation: List[VoiceAssistantMessage] = Field(default_factory=list)

class VoiceAssistantResponse(BaseModel):
    action: str
    response: str
    parameters: Optional[dict] = None
    intent: Optional[str] = None
    data: Optional[Any] = None
