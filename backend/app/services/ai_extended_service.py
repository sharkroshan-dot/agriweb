import random
import math
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

from app.services.data_assistant_service import data_assistant_service

logger = logging.getLogger(__name__)

CROPS_DB = {
    "rice": {"soil": ["clay", "loamy"], "season": ["kharif"], "min_temp": 20, "max_temp": 38, "min_rain": 100, "max_rain": 200, "duration": "120-150 days"},
    "wheat": {"soil": ["loamy", "clay"], "season": ["rabi"], "min_temp": 10, "max_temp": 25, "min_rain": 50, "max_rain": 100, "duration": "100-130 days"},
    "tomato": {"soil": ["loamy", "sandy"], "season": ["kharif", "rabi", "summer"], "min_temp": 18, "max_temp": 30, "min_rain": 40, "max_rain": 80, "duration": "60-80 days"},
    "potato": {"soil": ["sandy", "loamy"], "season": ["rabi"], "min_temp": 15, "max_temp": 25, "min_rain": 30, "max_rain": 70, "duration": "70-100 days"},
    "onion": {"soil": ["loamy", "sandy"], "season": ["kharif", "rabi"], "min_temp": 13, "max_temp": 35, "min_rain": 30, "max_rain": 80, "duration": "100-150 days"},
    "chilli": {"soil": ["loamy", "clay"], "season": ["kharif", "summer"], "min_temp": 20, "max_temp": 38, "min_rain": 60, "max_rain": 120, "duration": "70-100 days"},
    "brinjal": {"soil": ["loamy", "sandy"], "season": ["kharif", "summer"], "min_temp": 18, "max_temp": 35, "min_rain": 60, "max_rain": 100, "duration": "80-120 days"},
    "cabbage": {"soil": ["loamy", "clay"], "season": ["rabi"], "min_temp": 10, "max_temp": 25, "min_rain": 40, "max_rain": 80, "duration": "70-120 days"},
    "cauliflower": {"soil": ["loamy", "clay"], "season": ["rabi"], "min_temp": 8, "max_temp": 25, "min_rain": 50, "max_rain": 80, "duration": "90-150 days"},
    "spinach": {"soil": ["loamy", "sandy"], "season": ["rabi", "summer"], "min_temp": 5, "max_temp": 30, "min_rain": 30, "max_rain": 60, "duration": "30-45 days"},
    "carrot": {"soil": ["sandy", "loamy"], "season": ["rabi"], "min_temp": 10, "max_temp": 25, "min_rain": 30, "max_rain": 60, "duration": "80-110 days"},
    "groundnut": {"soil": ["sandy", "loamy"], "season": ["kharif", "summer"], "min_temp": 20, "max_temp": 35, "min_rain": 50, "max_rain": 100, "duration": "100-150 days"},
    "sugarcane": {"soil": ["loamy", "clay"], "season": ["kharif"], "min_temp": 20, "max_temp": 40, "min_rain": 75, "max_rain": 150, "duration": "300-360 days"},
    "cotton": {"soil": ["black", "loamy"], "season": ["kharif"], "min_temp": 21, "max_temp": 36, "min_rain": 50, "max_rain": 100, "duration": "150-200 days"},
    "maize": {"soil": ["loamy", "sandy"], "season": ["kharif", "summer"], "min_temp": 18, "max_temp": 35, "min_rain": 50, "max_rain": 100, "duration": "90-120 days"},
    "banana": {"soil": ["loamy", "clay"], "season": ["kharif", "summer"], "min_temp": 20, "max_temp": 38, "min_rain": 100, "max_rain": 200, "duration": "300-365 days"},
    "mango": {"soil": ["loamy", "sandy"], "season": ["summer"], "min_temp": 15, "max_temp": 40, "min_rain": 50, "max_rain": 250, "duration": "120-150 days to harvest"},
    "coconut": {"soil": ["sandy", "loamy"], "season": ["kharif", "summer"], "min_temp": 22, "max_temp": 38, "min_rain": 100, "max_rain": 300, "duration": "365 days"},
    "turmeric": {"soil": ["loamy", "clay"], "season": ["kharif"], "min_temp": 20, "max_temp": 35, "min_rain": 100, "max_rain": 200, "duration": "200-250 days"},
}

DISEASES_DB = {
    "tomato": {
        "early_blight": {
            "description": "Fungal disease causing dark spots with concentric rings on lower leaves",
            "treatment": "Apply Mancozeb or Chlorothalonil fungicide every 7-10 days",
            "prevention": "Use disease-free seeds, practice crop rotation, ensure proper spacing",
            "severity": "moderate"
        },
        "late_blight": {
            "description": "Water-soaked lesions on leaves and fruits with white fungal growth",
            "treatment": "Apply Metalaxyl or Copper-based fungicides immediately",
            "prevention": "Avoid overhead irrigation, remove infected plants, use resistant varieties",
            "severity": "high"
        },
        "leaf_curl": {
            "description": "Leaves curl upward, become yellow, and plant growth is stunted",
            "treatment": "Control whiteflies with Imidacloprid, remove infected plants",
            "prevention": "Use nets to protect seedlings, remove weed hosts",
            "severity": "high"
        }
    },
    "rice": {
        "blast": {
            "description": "Diamond-shaped lesions on leaves with gray centers and brown borders",
            "treatment": "Apply Tricyclazole or Carbendazim at first sign of disease",
            "prevention": "Use resistant varieties, avoid excess nitrogen, maintain proper spacing",
            "severity": "high"
        },
        "bacterial_blight": {
            "description": "Yellow to white streaks along leaf veins, leaves dry up",
            "treatment": "Apply Streptomycin sulfate + Copper oxychloride",
            "prevention": "Use disease-free seeds, avoid standing water, practice field sanitation",
            "severity": "high"
        }
    },
    "wheat": {
        "rust": {
            "description": "Orange or brown powdery pustules on leaves and stems",
            "treatment": "Apply Propiconazole or Tebuconazole fungicide",
            "prevention": "Grow resistant varieties, early sowing, avoid excess nitrogen",
            "severity": "moderate"
        }
    },
    "potato": {
        "late_blight": {
            "description": "Water-soaked spots on leaves, white mold on underside in wet weather",
            "treatment": "Apply Mancozeb or Chlorothalonil preventively, Metalaxyl if infection occurs",
            "prevention": "Use certified disease-free seed potatoes, hill soil around plants",
            "severity": "high"
        }
    }
}

CHATBOT_RESPONSES = {
    "english": {
        "upload": "To upload your products, go to your Farmer Dashboard and click 'Add Product'. Fill in the details like name, price, quantity, and upload clear photos of your produce.",
        "harvest": "Harvest tomatoes when they are firm and fully colored. For most vegetables, early morning harvesting is best. Use clean tools to avoid damaging the plant.",
        "price": "You can check the AI Price Prediction on your dashboard. It analyzes market trends and suggests the best selling price for your produce.",
        "register": "Click on 'Register' on the homepage. Fill in your details, select 'Farmer' as your role, and complete the verification process.",
        "payment": "We support UPI, Debit Cards, Credit Cards, Net Banking, and Cash on Delivery. Payments are processed securely through Razorpay.",
        "delivery": "You can choose Self Delivery, Local Delivery Partner, or our Logistics Network. Set your delivery preferences in your profile settings.",
        "default": "I'm here to help! You can ask me about uploading products, harvesting tips, pricing, registration, payments, or delivery."
    },
    "tamil": {
        "upload": "உங்கள் தயாரிப்புகளைப் பதிவேற்ற, உங்கள் விவசாயி டாஷ்போர்டுக்குச் சென்று 'தயாரிப்பைச் சேர்' என்பதைக் கிளிக் செய்யவும். பெயர், விலை, அளவு போன்ற விவரங்களை நிரப்பி, உங்கள் விளைபொருட்களின் தெளிவான புகைப்படங்களைப் பதிவேற்றவும்.",
        "harvest": "தக்காளி உறுதியாகவும் முழு நிறமாகவும் இருக்கும்போது அறுவடை செய்யவும். பெரும்பாலான காய்கறிகளுக்கு, அதிகாலையில் அறுவடை செய்வது சிறந்தது.",
        "price": "உங்கள் டாஷ்போர்டில் AI விலை முன்னறிவிப்பைச் சரிபார்க்கலாம். இது சந்தைப் போக்குகளை பகுப்பாய்வு செய்து உங்கள் விளைபொருட்களுக்கான சிறந்த விற்பனை விலையை பரிந்துரைக்கிறது.",
        "register": "முகப்புப் பக்கத்தில் 'பதிவு' என்பதைக் கிளிக் செய்யவும். உங்கள் விவரங்களை நிரப்பவும், 'விவசாயி' என்பதைத் தேர்ந்தெடுக்கவும்.",
        "payment": "நாங்கள் UPI, டெபிட் கார்டுகள், கிரெடிட் கார்டுகள், நெட் பேங்கிங் மற்றும் டெலிவரியில் பணம் ஆகியவற்றை ஆதரிக்கிறோம்.",
        "default": "நான் உதவ இங்கே இருக்கிறேன்! தயாரிப்புகளைப் பதிவேற்றுதல், அறுவடை குறிப்புகள், விலை நிர்ணயம், பதிவு மற்றும் டெலிவரி பற்றி என்னிடம் கேட்கலாம்."
    },
    "hindi": {
        "upload": "अपने उत्पाद अपलोड करने के लिए, अपने किसान डैशबोर्ड पर जाएं और 'उत्पाद जोड़ें' पर क्लिक करें। नाम, मूल्य, मात्रा जैसे विवरण भरें और अपनी उपज की स्पष्ट तस्वीरें अपलोड करें।",
        "harvest": "टमाटर की कटाई तब करें जब वे सख्त और पूरी तरह से रंगीन हों। अधिकांश सब्जियों के लिए, सुबह जल्दी कटाई करना सबसे अच्छा है।",
        "price": "आप अपने डैशबोर्ड पर AI मूल्य पूर्वानुमान की जांच कर सकते हैं। यह बाजार के रुझानों का विश्लेषण करता है और आपकी उपज के लिए सर्वोत्तम विक्रय मूल्य सुझाता है।",
        "register": "होमपेज पर 'पंजीकरण' पर क्लिक करें। अपना विवरण भरें, 'किसान' भूमिका चुनें और सत्यापन प्रक्रिया पूरी करें।",
        "payment": "हम UPI, डेबिट कार्ड, क्रेडिट कार्ड, नेट बैंकिंग और कैश ऑन डिलीवरी का समर्थन करते हैं।",
        "default": "मैं यहाँ मदद करने के लिए हूँ! आप मुझसे उत्पाद अपलोड करने, कटाई युक्तियाँ, मूल्य निर्धारण, पंजीकरण, भुगतान या डिलीवरी के बारे में पूछ सकते हैं।"
    }
}

class AIExtendedService:

    @staticmethod
    async def recommend_crop(request) -> Dict[str, Any]:
        try:
            suitable_crops = []
            for crop, info in CROPS_DB.items():
                score = 0
                reasons = []

                if request.soilType.lower() in info["soil"]:
                    score += 30
                else:
                    reasons.append(f"Soil type {request.soilType} is not ideal")

                if request.season.lower() in info["season"]:
                    score += 25
                else:
                    reasons.append(f"Season {request.season} is not optimal")

                if info["min_temp"] <= request.temperature <= info["max_temp"]:
                    score += 20
                else:
                    reasons.append(f"Temperature {request.temperature}°C outside ideal range {info['min_temp']}-{info['max_temp']}°C")

                if info["min_rain"] <= request.rainfall <= info["max_rain"]:
                    score += 15
                else:
                    reasons.append(f"Rainfall {request.rainfall}mm outside ideal range {info['min_rain']}-{info['max_rain']}mm")

                if request.previousCrop and request.previousCrop.lower() != crop:
                    score += 10

                crop_suitability = {
                    "crop": crop.title(),
                    "score": score,
                    "suitability": "high" if score >= 70 else "moderate" if score >= 50 else "low",
                    "duration": info["duration"],
                    "soil": ", ".join(info["soil"]),
                    "season": ", ".join(info["season"]),
                    "reasons": reasons
                }
                suitable_crops.append(crop_suitability)

            suitable_crops.sort(key=lambda x: x["score"], reverse=True)
            top_crops = suitable_crops[:5]

            return {
                "recommendations": top_crops,
                "topCrop": top_crops[0]["crop"] if top_crops else "No suitable crop found",
                "soilHealth": f"Your {request.soilType} soil is best suited for crops like {', '.join(c['crop'] for c in top_crops[:3])}",
                "seasonInfo": f"{request.season.title()} season - Plant after first rainfall, ensure proper drainage",
                "timestamp": datetime.utcnow()
            }
        except Exception as e:
            logger.error(f"Crop recommendation error: {e}")
            return {
                "recommendations": [
                    {"crop": "Tomato", "score": 85, "suitability": "high", "duration": "60-80 days", "soil": "loamy, sandy", "season": "kharif, rabi, summer"},
                    {"crop": "Rice", "score": 75, "suitability": "high", "duration": "120-150 days", "soil": "clay, loamy", "season": "kharif"},
                    {"crop": "Chilli", "score": 70, "suitability": "high", "duration": "70-100 days", "soil": "loamy, clay", "season": "kharif, summer"}
                ],
                "topCrop": "Tomato",
                "soilHealth": "Based on your inputs, vegetables and grains are suitable",
                "seasonInfo": "Consider seasonal crop rotation for best yields",
                "timestamp": datetime.utcnow()
            }

    @staticmethod
    async def chatbot_response(request, current_user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        lang = request.language.lower()
        if lang not in CHATBOT_RESPONSES:
            lang = "english"

        result = await data_assistant_service.answer(
            message=request.message,
            language=lang,
            user=current_user,
        )
        return {
            "reply": result.get("reply") or CHATBOT_RESPONSES[lang]["default"],
            "language": lang,
            "intent": result.get("intent", "default"),
        }

    @staticmethod
    async def search_products_for_chat(query: str) -> List[Dict[str, Any]]:
        """Retrieve current products from the marketplace (never invented)."""
        try:
            from app.repositories.product_repository import product_repository
            products = await product_repository.find_many({
                "isActive": True,
                "deletedAt": None,
                "isBasketOnly": {"$ne": True},
            }, limit=20)
            products = products or []

            # Score by keyword overlap with name/farm, then price filter keywords.
            keywords = [w for w in query.replace("₹", "").split() if w not in
                        {"find", "search", "buy", "me", "the", "a", "below", "under", "within", "and", "fresh", "near", "available"}]
            priced = None
            for token in query.replace("₹", " ").split():
                try:
                    priced = float(token)
                    break
                except (TypeError, ValueError):
                    continue

            scored = []
            for p in products:
                name = (p.get("name", "") or "").lower()
                farm = ((p.get("farmName") or p.get("farmerName") or "") or "").lower()
                score = sum(1 for k in keywords if k.lower() in name or k.lower() in farm)
                price = float(p.get("price", 0) or 0)
                if priced is not None and price > priced:
                    continue
                scored.append((score, price, p))

            scored.sort(key=lambda x: (-x[0], x[1]))
            return [p for s, price, p in scored[:10]] if scored else products[:10]
        except Exception as e:
            logger.error(f"Product search for chat failed: {e}")
            return []

    @staticmethod
    async def detect_disease(request) -> Dict[str, Any]:
        plant_type = (request.plantType or "tomato").lower()
        if plant_type not in DISEASES_DB:
            plant_type = "tomato"

        plant_diseases = DISEASES_DB[plant_type]
        disease_name = "early_blight" if plant_type == "tomato" else next(iter(plant_diseases.keys()))
        disease_info = plant_diseases[disease_name]

        return {
            "diseaseName": disease_name.replace("_", " ").title(),
            "confidence": 0.94,
            "description": disease_info["description"],
            "treatment": disease_info["treatment"],
            "prevention": disease_info["prevention"],
            "severity": disease_info["severity"]
        }

    @staticmethod
    async def voice_assistant(request, current_user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        text = request.audioText.lower()
        lang = request.language.lower()

        product_keywords = {
            "tomato": "தக்காளி", "onion": "வெங்காயம்", "potato": "உருளைக்கிழங்கு",
            "brinjal": "கத்தரிக்காய்", "chilli": "மிளகாய்", "banana": "வாழைப்பழம்",
            "rice": "அரிசி", "wheat": "கோதுமை", "milk": "பால்"
        }

        if any(word in text for word in ["add", "சேர்க்க", "upload"]):
            for product_en, product_ta in product_keywords.items():
                if product_en in text or product_ta in text:
                    return {
                        "action": "add_product",
                        "response": f"Adding {product_en.title()} to your products. Opening product form...",
                        "parameters": {"product": product_en, "name": f"Fresh {product_en.title()}"}
                    }

            return {
                "action": "add_product_prompt",
                "response": "Which product would you like to add?",
                "parameters": None
            }

        if any(word in text for word in ["show", "display", "list", "orders", "ஆர்டர்கள்", "show orders"]):
            return {
                "action": "show_orders",
                "response": "Opening your orders page...",
                "parameters": None
            }

        if any(word in text for word in ["dashboard", "home", "டாஷ்போர்டு", "मुख्य पृष्ठ"]):
            return {
                "action": "go_dashboard",
                "response": "Taking you to your dashboard...",
                "parameters": None
            }

        result = await data_assistant_service.answer(
            message=request.audioText,
            language=lang,
            user=current_user,
        )
        return {
            "action": "chat_reply",
            "response": result.get("reply") or f"You said: {request.audioText}. How can I help you?",
            "parameters": {"intent": result.get("intent", "unknown"), "language": lang}
        }

    @staticmethod
    def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    CROP_MATURITY_DB = {
        "rice": {"min_days": 120, "max_days": 150, "quality_peak": 135},
        "wheat": {"min_days": 100, "max_days": 130, "quality_peak": 115},
        "tomato": {"min_days": 60, "max_days": 80, "quality_peak": 70},
        "potato": {"min_days": 70, "max_days": 100, "quality_peak": 85},
        "onion": {"min_days": 100, "max_days": 150, "quality_peak": 125},
        "chilli": {"min_days": 70, "max_days": 100, "quality_peak": 85},
        "brinjal": {"min_days": 80, "max_days": 120, "quality_peak": 100},
        "cabbage": {"min_days": 70, "max_days": 120, "quality_peak": 95},
        "cauliflower": {"min_days": 90, "max_days": 150, "quality_peak": 120},
        "spinach": {"min_days": 30, "max_days": 45, "quality_peak": 38},
        "carrot": {"min_days": 80, "max_days": 110, "quality_peak": 95},
        "groundnut": {"min_days": 100, "max_days": 150, "quality_peak": 125},
        "sugarcane": {"min_days": 300, "max_days": 360, "quality_peak": 330},
        "cotton": {"min_days": 150, "max_days": 200, "quality_peak": 175},
        "maize": {"min_days": 90, "max_days": 120, "quality_peak": 105},
        "banana": {"min_days": 300, "max_days": 365, "quality_peak": 330},
        "mango": {"min_days": 120, "max_days": 150, "quality_peak": 135},
        "coconut": {"min_days": 365, "max_days": 365, "quality_peak": 365},
        "turmeric": {"min_days": 200, "max_days": 250, "quality_peak": 225},
    }

    VEHICLE_SPEEDS = {
        "bike": 30,
        "car": 40,
        "van": 35,
        "truck": 25,
    }

    @staticmethod
    async def smart_harvest_planner(request) -> Dict[str, Any]:
        try:
            crop = request.cropType.lower()
            crop_data = AIExtendedService.CROP_MATURITY_DB.get(crop, {"min_days": 60, "max_days": 90, "quality_peak": 75})
            planting = request.plantingDate
            if planting.tzinfo is not None:
                planting = planting.astimezone(timezone.utc).replace(tzinfo=None)

            earliest_harvest = planting + timedelta(days=crop_data["min_days"])
            peak_quality = planting + timedelta(days=crop_data["quality_peak"])
            latest_harvest = planting + timedelta(days=crop_data["max_days"])

            now = datetime.utcnow()
            days_since_planting = (now - planting).days

            weather_temp = 28
            weather_rain = 5
            weather_score = 1.0
            if weather_temp > 35 or weather_temp < 10:
                weather_score -= 0.2
            if weather_rain > 50:
                weather_score -= 0.15
            weather_score = max(0.3, weather_score)

            festivals = [
                {"name": "Diwali", "month": 11, "impact": 1.4},
                {"name": "Pongal", "month": 1, "impact": 1.3},
                {"name": "Holi", "month": 3, "impact": 1.2},
                {"name": "Eid", "month": 5, "impact": 1.25},
                {"name": "Christmas", "month": 12, "impact": 1.35},
                {"name": "Navratri", "month": 10, "impact": 1.3},
            ]

            festival_spikes = []
            for f in festivals:
                if abs(f["month"] - peak_quality.month) <= 1:
                    festival_spikes.append({
                        "festival": f["name"],
                        "month": f["month"],
                        "demandMultiplier": f["impact"],
                        "alignsWithHarvest": abs(f["month"] - peak_quality.month) <= 1
                    })

            market_timing_score = weather_score * 0.4 + (1.0 if festival_spikes else 0.5) * 0.3 + 0.3
            market_timing_score = round(min(1.0, market_timing_score), 2)

            quality_scores = [
                {"date": earliest_harvest.strftime("%Y-%m-%d"), "quality": "good", "score": 0.7},
                {"date": peak_quality.strftime("%Y-%m-%d"), "quality": "excellent", "score": 0.95},
                {"date": latest_harvest.strftime("%Y-%m-%d"), "quality": "fair", "score": 0.6},
            ]
            if peak_quality != earliest_harvest and peak_quality != latest_harvest:
                mid_quality = earliest_harvest + timedelta(days=(peak_quality - earliest_harvest).days // 2)
                quality_scores.insert(1, {"date": mid_quality.strftime("%Y-%m-%d"), "quality": "very_good", "score": 0.82})

            alternative_windows = []
            if crop_data["min_days"] != crop_data["max_days"]:
                alt_early = planting + timedelta(days=crop_data["min_days"] - 5)
                alt_late = planting + timedelta(days=crop_data["max_days"] + 5)
                alternative_windows.append({
                    "start": alt_early.strftime("%Y-%m-%d"),
                    "end": alt_late.strftime("%Y-%m-%d"),
                    "quality": "early harvest - lower yield, premium prices",
                    "score": 0.65
                })

            weather_advisory = "Favorable conditions expected" if weather_score > 0.7 else "Monitor weather closely"

            return {
                "productId": request.productId,
                "cropType": crop.title(),
                "recommendedDateRange": {
                    "start": earliest_harvest.strftime("%Y-%m-%d"),
                    "end": latest_harvest.strftime("%Y-%m-%d"),
                    "quality": "peak",
                    "score": round(0.85 * weather_score, 2)
                },
                "alternativeWindows": alternative_windows,
                "expectedQualityAtDifferentDates": quality_scores,
                "marketTimingScore": market_timing_score,
                "weatherAdvisory": weather_advisory,
                "festivalDemandSpikes": festival_spikes,
                "timestamp": datetime.utcnow()
            }
        except Exception as e:
            logger.error(f"Smart harvest planner error: {e}")
            return {
                "productId": request.productId,
                "cropType": request.cropType,
                "recommendedDateRange": {"start": "2025-11-01", "end": "2025-11-15", "quality": "peak", "score": 0.85},
                "alternativeWindows": [],
                "expectedQualityAtDifferentDates": [],
                "marketTimingScore": 0.75,
                "weatherAdvisory": "Standard harvest window applies",
                "festivalDemandSpikes": [],
                "timestamp": datetime.utcnow()
            }

    @staticmethod
    async def delivery_time_estimation(request) -> Dict[str, Any]:
        try:
            R = 6371
            dlat = math.radians(request.destinationLat - request.originLat)
            dlng = math.radians(request.destinationLng - request.originLng)
            a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(request.originLat)) * math.cos(math.radians(request.destinationLat)) * math.sin(dlng / 2) ** 2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            distance_km = R * c

            speed = AIExtendedService.VEHICLE_SPEEDS.get(request.vehicleType.lower(), 30)
            base_time_minutes = (distance_km / speed) * 60

            traffic_multiplier = 1.0
            if 8 <= request.timeOfDay <= 10 or 17 <= request.timeOfDay <= 19:
                traffic_multiplier = 1.5

            day_multiplier = 1.0 if request.dayOfWeek < 5 else 0.8

            weather_multiplier = 1.0
            weather_condition = "clear"
            rand_val = random.random()
            if rand_val < 0.15:
                weather_multiplier = 1.3
                weather_condition = "rainy"
            elif rand_val < 0.3:
                weather_multiplier = 1.15
                weather_condition = "cloudy"

            estimated_minutes = base_time_minutes * traffic_multiplier * day_multiplier * weather_multiplier

            confidence = 1.0
            if traffic_multiplier > 1.0:
                confidence -= 0.1
            if weather_multiplier > 1.1:
                confidence -= 0.15
            confidence = round(max(0.5, confidence), 2)

            return {
                "estimatedMinutes": round(estimated_minutes, 1),
                "estimatedDistance": round(distance_km, 2),
                "confidence": confidence,
                "factors": {
                    "distance": round(distance_km, 2),
                    "baseTime": round(base_time_minutes, 1),
                    "trafficMultiplier": traffic_multiplier,
                    "weatherMultiplier": weather_multiplier,
                    "dayMultiplier": day_multiplier,
                    "vehicleSpeed": speed
                },
                "timestamp": datetime.utcnow()
            }
        except Exception as e:
            logger.error(f"Delivery time estimation error: {e}")
            return {
                "estimatedMinutes": 45.0,
                "estimatedDistance": 25.0,
                "confidence": 0.7,
                "factors": {"distance": 25.0, "baseTime": 60.0, "trafficMultiplier": 1.0, "weatherMultiplier": 1.0, "dayMultiplier": 1.0, "vehicleSpeed": 30},
                "timestamp": datetime.utcnow()
            }

    @staticmethod
    async def demand_heat_map(request, current_user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Data-driven demand intelligence. See demand_heatmap_service."""
        from app.services.demand_heatmap_service import build_demand_heatmap
        return await build_demand_heatmap(request, current_user)

    @staticmethod
    async def community_order_grouping(orders) -> Dict[str, Any]:
        try:
            order_list = orders.orders
            n = len(order_list)
            if n == 0:
                return {
                    "groups": [],
                    "totalGroups": 0,
                    "totalDistanceKm": 0,
                    "totalTimeMinutes": 0,
                    "unassignedOrders": [],
                    "timestamp": datetime.utcnow()
                }

            capacity = orders.vehicleCapacity

            order_ids = []
            coords = []
            weights = []
            for o in order_list:
                order_ids.append(o.orderId)
                coords.append((o.lat, o.lng))
                weights.append(o.weight)

            n_clusters = max(1, min(n, int(round(n / 5)) + 1))

            centroids = []
            if n_clusters >= n:
                centroids = coords[:]
            else:
                indices = list(range(n))
                random.shuffle(indices)
                selected = indices[:n_clusters]
                centroids = [coords[i] for i in selected]

            for _ in range(20):
                clusters = [[] for _ in range(len(centroids))]
                for i in range(n):
                    min_dist = float("inf")
                    best = 0
                    for j, cent in enumerate(centroids):
                        d = AIExtendedService._haversine(coords[i][0], coords[i][1], cent[0], cent[1])
                        if d < min_dist:
                            min_dist = d
                            best = j
                    clusters[best].append(i)

                new_centroids = []
                for c in clusters:
                    if c:
                        avg_lat = sum(coords[i][0] for i in c) / len(c)
                        avg_lng = sum(coords[i][1] for i in c) / len(c)
                        new_centroids.append((avg_lat, avg_lng))
                    else:
                        new_centroids.append((0, 0))
                centroids = new_centroids

            clusters = [[] for _ in range(len(centroids))]
            for i in range(n):
                min_dist = float("inf")
                best = 0
                for j, cent in enumerate(centroids):
                    d = AIExtendedService._haversine(coords[i][0], coords[i][1], cent[0], cent[1])
                    if d < min_dist:
                        min_dist = d
                        best = j
                clusters[best].append(i)

            groups = []
            group_id = 0
            unassigned = []

            for cluster_idx, cluster_points in enumerate(clusters):
                if not cluster_points:
                    continue

                total_weight = sum(weights[i] for i in cluster_points)
                if total_weight > capacity:
                    cluster_points.sort(key=lambda i: weights[i], reverse=True)
                    feasible = []
                    remaining = []
                    current_w = 0
                    for i in cluster_points:
                        if current_w + weights[i] <= capacity:
                            feasible.append(i)
                            current_w += weights[i]
                        else:
                            remaining.append(i)
                    for i in remaining:
                        unassigned.append(order_ids[i])
                    cluster_points = feasible

                if not cluster_points:
                    continue

                centroid_lat = sum(coords[i][0] for i in cluster_points) / len(cluster_points)
                centroid_lng = sum(coords[i][1] for i in cluster_points) / len(cluster_points)

                sorted_indices = sorted(cluster_points, key=lambda i: AIExtendedService._haversine(0, 0, coords[i][0], coords[i][1]))

                route_coords = [{"lat": coords[i][0], "lng": coords[i][1]} for i in sorted_indices]
                route_dist = 0
                prev = None
                for i in sorted_indices:
                    if prev is not None:
                        route_dist += AIExtendedService._haversine(coords[prev][0], coords[prev][1], coords[i][0], coords[i][1])
                    prev = i

                route_time = (route_dist / 30) * 60

                utilization = round((total_weight / capacity) * 100, 1)

                groups.append({
                    "groupId": group_id,
                    "orders": [order_ids[i] for i in sorted_indices],
                    "centroid": {"lat": round(centroid_lat, 6), "lng": round(centroid_lng, 6)},
                    "route": {
                        "stopSequence": [order_ids[i] for i in sorted_indices],
                        "totalDistanceKm": round(route_dist, 2),
                        "totalTimeMinutes": round(route_time, 1),
                        "optimizedRoute": route_coords
                    },
                    "utilizationPercent": utilization
                })
                group_id += 1

            total_dist = sum(g["route"]["totalDistanceKm"] for g in groups)
            total_time = sum(g["route"]["totalTimeMinutes"] for g in groups)

            return {
                "groups": groups,
                "totalGroups": len(groups),
                "totalDistanceKm": round(total_dist, 2),
                "totalTimeMinutes": round(total_time, 1),
                "unassignedOrders": unassigned,
                "timestamp": datetime.utcnow()
            }
        except Exception as e:
            logger.error(f"Community order grouping error: {e}")
            return {
                "groups": [],
                "totalGroups": 0,
                "totalDistanceKm": 0,
                "totalTimeMinutes": 0,
                "unassignedOrders": [],
                "timestamp": datetime.utcnow()
            }
