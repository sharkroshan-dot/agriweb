import re
import logging
import json
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from bson import ObjectId

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "find", "search", "show", "list", "buy", "me", "the", "a", "an", "of", "for",
    "and", "or", "with", "under", "within", "below", "above", "near", "nearby",
    "available", "fresh", "please", "can", "you", "i", "want", "to", "my", "your",
    "what", "which", "how", "much", "many", "are", "is", "do", "does", "tell",
    "give", "show", "get", "some", "there", "in", "on", "at", "rs", "rupees", "₹",
}

HELP_RESPONSES = {
    "english": {
        "register": "To register, click 'Register' on the homepage, fill in your details, select your role (farmer, customer or delivery partner) and complete the verification process. It takes less than 2 minutes.",
        "upload": "To add a product, go to your Farmer Dashboard and click 'Add Product'. Fill in the name, price, quantity and unit, and upload clear photos of your produce. The listing goes live immediately.",
        "payment": "We support UPI, debit cards, credit cards, net banking and cash on delivery. Payments are processed securely and you can track them from your orders page.",
        "delivery": "Orders can be delivered by the farmer themselves, a local delivery partner, or our logistics network. You can choose your delivery preference at checkout.",
        "price": "You can use the AI Price Prediction on your dashboard. It analyses market trends and historical sales to suggest the best selling price for your produce.",
        "how": "I can help with product searches, current prices, your orders, your wallet and platform how-to. Try asking things like 'find tomatoes below ₹100' or 'show my orders'.",
        "default": "I can answer questions about products and prices, farmers, orders, your wallet and the marketplace. Ask me anything, e.g. 'list organic vegetables', 'what is the price of rice?' or 'show my orders'.",
    },
    "tamil": {
        "register": "பதிவு செய்ய, முகப்புப் பக்கத்தில் 'பதிவு' என்பதைக் கிளிக் செய்து, உங்கள் விவரங்களை நிரப்பவும், உங்கள் பங்கைத் தேர்ந்தெடுக்கவும்.",
        "upload": "தயாரிப்பைச் சேர்க்க, உங்கள் விவசாயி டாஷ்போர்டுக்குச் சென்று 'தயாரிப்பைச் சேர்' என்பதைக் கிளிக் செய்யவும்.",
        "payment": "நாங்கள் UPI, டெபிட் கார்டுகள், கிரெடிட் கார்டுகள், நெட் பேங்கிங் மற்றும் டெலிவரியில் பணம் ஆகியவற்றை ஆதரிக்கிறோம்.",
        "delivery": "ஆர்டர்களை விவசாயி, உள்ளூர் டெலிவரி பார்ட்னர் அல்லது எங்கள் லாஜிஸ்டிக்ஸ் நெட்வொர்க் மூலம் வழங்கலாம்.",
        "price": "AI விலை முன்னறிவிப்பை உங்கள் டாஷ்போர்டில் சரிபார்க்கலாம்.",
        "how": "தயாரிப்புகள், விலைகள், ஆர்டர்கள், உங்கள் வாலட் பற்றி என்னிடம் கேட்கலாம்.",
        "default": "தயாரிப்புகள், விலைகள், விவசாயிகள், ஆர்டர்கள் மற்றும் உங்கள் வாலட் பற்றி கேளுங்கள்.",
    },
    "hindi": {
        "register": "पंजीकरण करने के लिए, होमपेज पर 'पंजीकरण' पर क्लिक करें और अपना विवरण भरें।",
        "upload": "उत्पाद जोड़ने के लिए, अपने किसान डैशबोर्ड पर जाएं और 'उत्पाद जोड़ें' पर क्लिक करें।",
        "payment": "हम UPI, डेबिट कार्ड, क्रेडिट कार्ड, नेट बैंकिंग और कैश ऑन डिलीवरी का समर्थन करते हैं।",
        "delivery": "ऑर्डर किसान, स्थानीय डिलीवरी पार्टनर या हमारे लॉजिस्टिक्स नेटवर्क द्वारा वितरित किए जा सकते हैं।",
        "price": "आप अपने डैशबोर्ड पर AI मूल्य पूर्वानुमान की जांच कर सकते हैं।",
        "how": "उत्पादों, कीमतों, ऑर्डर और अपने वॉलेट के बारे में पूछें।",
        "default": "उत्पादों, कीमतों, किसानों, ऑर्डर और अपने वॉलेट के बारे में पूछें।",
    },
}

PROJECT_SCOPE_RESPONSES = {
    "english": {
        "overview": "AgriConnect is a farm-to-home marketplace connecting customers with farmers. It supports product discovery, farmer listings, ordering, delivery management, subscriptions, traceability, analytics and AI-assisted decisions.",
        "ai": "AgriConnect includes AI for demand forecasting, price prediction, recommendations, delivery-risk analysis, route optimization, fraud and anomaly detection, quality assistance and the AI Farm Assistant.",
        "roles": "AgriConnect supports customer, farmer, delivery partner, business, warehouse and admin workflows. Each role has separate screens and permissions.",
        "delivery": "Delivery supports farmer self-delivery, delivery partners and logistics operations, with delivery slots, route planning, order assignment and QR pickup verification.",
        "traceability": "Traceability connects produce with batch and quality information so the product journey can be followed from farm through marketplace and delivery.",
        "subscriptions": "Farm baskets and subscriptions support recurring produce purchases, including weekly, bi-weekly and monthly plans.",
        "b2b": "The B2B workflow supports business buyers and RFQs for larger agricultural product requirements.",
        "security": "The AI Farm Assistant is restricted to project information and permitted public marketplace information. It does not expose private orders, payment details, wallet balances, addresses, authentication data or another user's records.",
        "technology": "The project uses Next.js and TypeScript for the website, Flutter for mobile, FastAPI and Python for the backend, MongoDB for data storage and Redis services.",
        "help": "Ask me about AgriConnect features, workflows, AI modules, roles, marketplace functions, delivery, traceability, subscriptions, B2B, security, architecture and technology. I can also answer permitted public marketplace questions such as product availability and listed prices."
    },
    "tamil": {
        "overview": "AgriConnect என்பது விவசாயிகளையும் வாடிக்கையாளர்களையும் இணைக்கும் farm-to-home marketplace. Product discovery, farmer listings, ordering, delivery, subscriptions, traceability, analytics மற்றும் AI வசதிகள் இதில் உள்ளன.",
        "ai": "AgriConnect-ல் demand forecasting, price prediction, recommendations, delivery-risk analysis, route optimization, fraud/anomaly detection, quality assistance மற்றும் AI Farm Assistant போன்ற AI வசதிகள் உள்ளன.",
        "roles": "AgriConnect-ல் customer, farmer, delivery partner, business, warehouse மற்றும் admin workflows உள்ளன. ஒவ்வொரு role-க்கும் தனித்தனி permissions உள்ளன.",
        "delivery": "Delivery-ல் farmer self-delivery, delivery partners, delivery slots, route planning, order assignment மற்றும் QR pickup verification போன்ற வசதிகள் உள்ளன.",
        "traceability": "Traceability மூலம் batch மற்றும் quality தகவல்களை இணைத்து farm முதல் delivery வரை produce journey-ஐ பின்தொடர முடியும்.",
        "subscriptions": "Farm baskets மற்றும் subscriptions மூலம் weekly, bi-weekly மற்றும் monthly recurring purchases செய்ய முடியும்.",
        "b2b": "B2B workflow மூலம் business buyers RFQ அனுப்பி பெரிய அளவிலான agricultural product requirements-ஐ நிர்வகிக்க முடியும்.",
        "security": "பாதுகாப்பிற்காக AI Farm Assistant தனிப்பட்ட orders, payment, wallet, address, authentication அல்லது மற்ற பயனர்களின் records-ஐ வெளியிடாது.",
        "technology": "Website Next.js மற்றும் TypeScript, mobile Flutter, backend FastAPI/Python, MongoDB மற்றும் Redis services பயன்படுத்துகிறது.",
        "help": "AgriConnect features, AI, roles, marketplace, delivery, traceability, subscriptions, B2B, security, architecture மற்றும் technology பற்றி கேட்கலாம்."
    },
    "hindi": {
        "overview": "AgriConnect किसानों और ग्राहकों को जोड़ने वाला farm-to-home marketplace है। इसमें product discovery, farmer listings, ordering, delivery, subscriptions, traceability, analytics और AI सुविधाएं हैं.",
        "ai": "AgriConnect में demand forecasting, price prediction, recommendations, delivery-risk analysis, route optimization, fraud/anomaly detection, quality assistance और AI Farm Assistant शामिल हैं.",
        "roles": "AgriConnect में customer, farmer, delivery partner, business, warehouse और admin workflows हैं.",
        "delivery": "Delivery में farmer self-delivery, delivery partners, delivery slots, route planning, order assignment और QR pickup verification शामिल हैं.",
        "traceability": "Traceability batch और quality information को जोड़कर farm से delivery तक product journey दिखाती है.",
        "subscriptions": "Farm baskets और subscriptions weekly, bi-weekly और monthly recurring purchases को support करते हैं.",
        "b2b": "B2B workflow business buyers के RFQ और बड़े agricultural requirements को support करता है.",
        "security": "सुरक्षा के लिए AI Farm Assistant निजी orders, payment, wallet, address, authentication या दूसरे users के records को साझा नहीं करता.",
        "technology": "Website Next.js और TypeScript, mobile Flutter, backend FastAPI/Python, MongoDB और Redis services का उपयोग करता है.",
        "help": "AgriConnect features, AI, roles, marketplace, delivery, traceability, subscriptions, B2B, security, architecture और technology के बारे में पूछें."
    }
}

PRIVATE_DATA_RESPONSE = {
    "english": "For security, I don't provide personal orders, order details, payment information, wallet balances, private addresses, authentication information or another user's records through the AI Farm Assistant. I can explain the AgriConnect workflow instead.",
    "tamil": "பாதுகாப்பிற்காக AI Farm Assistant மூலம் தனிப்பட்ட orders, order details, payment, wallet, private address, authentication அல்லது மற்ற பயனர்களின் records வழங்கப்படாது. AgriConnect workflow பற்றி விளக்க முடியும்.",
    "hindi": "सुरक्षा के लिए AI Farm Assistant निजी orders, payment, wallet, address, authentication या दूसरे users के records साझा नहीं करता। मैं AgriConnect workflow समझा सकता हूँ।"
}

async def _answer_demand_forecast(text: str, low: str, lang: str) -> Optional[Dict[str, Any]]:
    """Answer natural-language product demand forecast questions with aggregate data only."""
    if not any(k in low for k in ["demand forecast", "demand prediction", "demand this week", "forecast demand", "demand for"]):
        return None

    product_name = next((p for p in sorted(PRODUCT_KEYWORDS, key=len, reverse=True) if p in low), None)
    if not product_name:
        return {
            "reply": "Which product would you like a demand forecast for? For example: 'What is the tomato demand forecast for this week?'",
            "language": lang, "intent": "demand_forecast", "data": None,
        }

    from app.repositories.product_repository import product_repository
    from app.repositories.order_repository import order_repository
    from app.ai.models.demand_forecast import demand_forecast_model

    products = await product_repository.find_many(
        {"deletedAt": None, "isActive": True, "isBasketOnly": {"$ne": True}}, limit=100
    )
    matches = [p for p in products if product_name in (p.get("name") or "").lower()]
    if not matches:
        return {
            "reply": f"I couldn't find {product_name.title()} in the current marketplace.",
            "language": lang, "intent": "demand_forecast", "data": None,
        }

    # Use aggregate delivered-order quantities, never customer identity/order details.
    product = matches[0]
    pid = product.get("_id")
    orders = await order_repository.find_many({
        "items.productId": pid,
        "orderStatus": "delivered",
        "deletedAt": None,
    }, limit=1000)

    history = []
    for order in orders:
        date = order.get("orderDate") or order.get("createdAt")
        for item in order.get("items", []):
            if str(item.get("productId")) == str(pid):
                history.append({"date": date, "demand": float(item.get("quantity", 0) or 0)})

    if not history:
        return {
            "reply": f"I found {product.get('name', product_name)} in the marketplace, but there is not enough historical demand data to produce a reliable forecast yet.",
            "language": lang, "intent": "demand_forecast", "data": {"productId": str(pid), "productName": product.get("name")},
        }

    try:
        prediction = demand_forecast_model.predict(history, 7)
        predicted = prediction.get("predicted_demand", []) if prediction else []
        current = prediction.get("current_demand", 0) if prediction else 0
        confidence = prediction.get("confidence", 0) if prediction else 0
        recommendation = prediction.get("recommendation", "Review current stock") if prediction else "Review current stock"
        summary = ", ".join(str(round(float(x), 1)) for x in predicted[:7])
        reply = (
            f"Demand forecast for {product.get('name', product_name)} for the next 7 days:\n"
            f"• Current demand: {round(float(current), 1)} units\n"
            f"• Forecast: {summary or 'Unavailable'}\n"
            f"• Confidence: {round(float(confidence) * 100)}%\n"
            f"• Recommendation: {recommendation}"
        )
        return {
            "reply": reply, "language": lang, "intent": "demand_forecast",
            "data": {"productId": str(pid), "productName": product.get("name"), "predictedDemand": predicted, "confidence": confidence},
        }
    except Exception as exc:
        logger.warning("Demand forecast failed for %s: %s", product_name, exc)
        return {
            "reply": f"I found {product.get('name', product_name)}, but its demand forecast is currently unavailable. Please try again after more sales data is available.",
            "language": lang, "intent": "demand_forecast", "data": {"productId": str(pid), "productName": product.get("name")},
        }

def _project_knowledge_reply(low: str, lang: str) -> Optional[str]:
    r = PROJECT_SCOPE_RESPONSES[lang]
    if any(k in low for k in ["what is agriconnect", "about agriconnect", "project overview", "overview", "what is this project"]):
        return r["overview"]
    if any(k in low for k in ["ai feature", "ai features", "artificial intelligence", "machine learning", "ai model", "ai assistant", "forecast", "prediction"]):
        return r["ai"]
    if any(k in low for k in ["role", "roles", "customer", "farmer", "delivery partner", "warehouse", "business user", "admin"]):
        return r["roles"]
    if any(k in low for k in ["delivery", "route", "pickup", "qr pickup", "delivery slot"]):
        return r["delivery"]
    if any(k in low for k in ["traceability", "trace a lot", "batch", "quality inspection"]):
        return r["traceability"]
    if any(k in low for k in ["subscription", "subscriptions", "farm basket", "farm baskets"]):
        return r["subscriptions"]
    if any(k in low for k in ["b2b", "rfq", "business buyer", "bulk buyer"]):
        return r["b2b"]
    if any(k in low for k in ["security", "privacy", "private data", "data protection"]):
        return r["security"]
    if any(k in low for k in ["technology", "tech stack", "framework", "database", "mongodb", "fastapi", "next.js", "flutter", "redis"]):
        return r["technology"]
    if any(k in low for k in ["what can you do", "what can i ask", "help", "features", "modules"]):
        return r["help"]
    return None

GREETING_RESPONSES = {
    "english": "Hello! I am your AgriConnect assistant. I use live data from the marketplace, so you can ask me about products, prices, farmers, your orders or your wallet.",
    "tamil": "வணக்கம்! நான் உங்கள் AgriConnect உதவியாளர். தயாரிப்புகள், விலைகள், விவசாயிகள், உங்கள் ஆர்டர்கள் அல்லது உங்கள் வாலட் பற்றி என்னிடம் கேளுங்கள்.",
    "hindi": "नमस्ते! मैं आपका AgriConnect सहायक हूँ। उत्पादों, कीमतों, किसानों, अपने ऑर्डर या अपने वॉलेट के बारे में मुझसे पूछें।",
}

THANKS_RESPONSES = {
    "english": "You're welcome! Anything else you would like to know?",
    "tamil": "நன்றி! வேறு ஏதாவது தெரிந்துகொள்ள விரும்புகிறீர்களா?",
    "hindi": "स्वागत है! और कुछ जानना चाहेंगे?",
}

PRODUCT_KEYWORDS = {
    "tomato", "onion", "potato", "brinjal", "eggplant", "chilli", "banana", "rice",
    "wheat", "milk", "carrot", "cabbage", "cauliflower", "spinach", "mango",
    "coconut", "sugarcane", "cotton", "maize", "corn", "turmeric", "ginger",
    "garlic", "okra", "lady finger", "bitter gourd", "bottle gourd", "cucumber",
    "pumpkin", "beans", "peas", "coriander", "mint", "apple", "orange", "grapes",
    "papaya", "guava", "pineapple", "lemon", "lime", "broccoli", "capsicum",
    "pepper", "basil", "mushroom", "yogurt", "curd", "butter", "cheese", "egg",
    "honey", "jaggery", "ghee", "vegetable", "vegetables", "fruit", "fruits",
    "produce", "grains", "pulses", "spices",
}


def _fmt_rs(value: float) -> str:
    try:
        value = float(value or 0)
    except (TypeError, ValueError):
        value = 0
    if value == int(value):
        return f"₹{int(value):,}"
    return f"₹{value:,.2f}"


def _extract_price(text: str) -> Optional[float]:
    match = re.search(r"₹\s*(\d+(?:\.\d+)?)", text)
    if match:
        return float(match.group(1))
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:rupees|rs\.?|rs|inr)", text, re.IGNORECASE)
    if match:
        return float(match.group(1))
    match = re.search(r"\b(?:rs\.?|rupees|inr)\s*(\d+(?:\.\d+)?)", text, re.IGNORECASE)
    if match:
        return float(match.group(1))
    return None


def _extract_order_number(text: str) -> Optional[str]:
    match = re.search(r"[A-Z]{2,6}-\d{8}-\d{6}", text, re.IGNORECASE)
    if match:
        return match.group(0).upper()
    match = re.search(r"ORD-\d{8}-\d{6}", text, re.IGNORECASE)
    if match:
        return match.group(0).upper()
    match = re.search(r"ORD-[A-Z0-9]{6,}", text, re.IGNORECASE)
    if match:
        return match.group(0).upper()
    return None


def _clean_keywords(text: str) -> List[str]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return [t for t in tokens if t not in STOP_WORDS and len(t) > 1]


SEMANTIC_ASSISTANT_SYSTEM = """AgriConnect local LLM planner. The model is trained locally from random initialization.
The planner returns structured requests only; live data and actions are executed by the backend.
"""

async def _semantic_plan(text: str, conversation: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    # No API key, Ollama, or external model is used here.
    from app.ai.agri_llm.planner import agri_llm_planner
    return await agri_llm_planner.plan(text, conversation)


async def _resolve_product_entity(query: str) -> Optional[str]:
    """Resolve the product entity from the live marketplace, independent of wording."""
    from app.repositories.product_repository import product_repository
    products=await product_repository.find_many({"isActive":True,"deletedAt":None,"isBasketOnly":{"$ne":True}},limit=200) or []
    low=(query or "").lower()
    candidates=[]
    for p in products:
        name=str(p.get("name") or "").strip()
        if not name: continue
        name_low=name.lower()
        if name_low in low:
            candidates.append(name)
            continue
        words=[w for w in re.findall(r"[a-z0-9]+",name_low) if len(w)>2]
        if words and all(w in low for w in words):
            candidates.append(name)
    return max(candidates,key=len) if candidates else None

async def _semantic_products(query: str, cheapest: bool=False) -> List[Dict[str, Any]]:
    from app.repositories.product_repository import product_repository
    products=await product_repository.find_many({"isActive":True,"deletedAt":None,"isBasketOnly":{"$ne":True}},limit=200) or []
    stop={"find","search","show","list","buy","need","want","give","me","the","a","an","product","products","available","fresh","cheap","cheapest","cheaper","lowest","price","best","for","to","from","some","please","can","you","i","get"}
    tokens=[t for t in re.findall(r"[a-z0-9]+",(query or "").lower()) if t not in stop and len(t)>1]
    scored=[]
    for p in products:
        hay=f"{p.get('name') or ''} {p.get('farmName') or p.get('farmerName') or ''}".lower()
        score=sum(1 for t in tokens if t in hay)
        if tokens and score==0: continue
        scored.append((score,float(p.get("price",0) or 0),p))
    scored.sort(key=lambda x:(x[1],-x[0]) if cheapest else (-x[0],x[1]))
    return [{"_id":str(p.get("_id")),"id":str(p.get("_id")),"name":p.get("name"),"price":float(p.get("price",0) or 0),"unit":p.get("unit") or "kg","farmerName":p.get("farmerName") or p.get("farmName") or "Local Farmer","quantity":p.get("quantity") or p.get("availableQuantity")} for _,_,p in scored[:10]]

def _allowed_product_id(value: Any) -> Optional[str]:
    try:
        return str(ObjectId(str(value)))
    except Exception:
        return None

def _semantic_route(destination: str) -> Optional[str]:
    return {"marketplace":"/nearby","product":"/nearby","orders":"/orders","cart":"/cart","wishlist":"/wishlist","subscriptions":"/subscriptions","traceability":"/trace","wallet":"/wallet","farmer_dashboard":"/farmer/dashboard","delivery":"/delivery/delivery","route":"/delivery/deliveries","analytics":"/farmer/analytics","ai_predictions":"/farmer/ai-predictions","home":"/"}.get((destination or "").lower())

async def _execute_semantic_request(item: Dict[str, Any], language: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    intent=item.get("intent","general")
    query=str(item.get("query") or item.get("product") or "").strip()
    product=str(item.get("product") or "").strip()
    if not product:
        product=await _resolve_product_entity(query) or ""
    if intent in {"product_search","cheapest_product"}:
        products=await _semantic_products(product or query, cheapest=intent=="cheapest_product")
        if product:
            product_matches=[p for p in products if product.lower() in str(p.get("name") or "").lower()]
            if product_matches:
                products=sorted(product_matches,key=lambda p: float(p.get("price",0) or 0)) if intent=="cheapest_product" else product_matches
        if not products: return {"reply":f"I couldn't find a matching product for '{product or query}'.","intent":"product_search","data":None}
        if intent=="cheapest_product":
            p=products[0]
            reply=f"The cheapest {product or 'matching'} product currently listed is {p['name']} at ₹{p['price']:g}/{p['unit']}."
            if item.get("open"):
                pid = _allowed_product_id(p.get("_id") or p.get("id"))
                if not pid:
                    return {"reply": reply, "intent": "cheapest_product", "data": products}
                return {"reply":reply+" Opening it for you to buy.","intent":"navigate","data":products,"action":"navigate","parameters":{"route":f"/product/{pid}","label":p["name"]}}
            return {"reply":reply,"intent":"cheapest_product","data":products}
        return {"reply":"I found these matching products:\n"+"\n".join(f"• {p['name']} — ₹{p['price']:g}/{p['unit']}" for p in products[:5]),"intent":"product_search","data":products}
    if intent=="navigate":
        route=_semantic_route(str(item.get("destination") or ""))
        if not route: return {"reply":"I understood that you want to open a page, but I couldn't identify the page yet.","intent":"navigate","data":None}
        return {"reply":f"Opening {str(item.get('destination')).replace('_',' ')}.","intent":"navigate","data":None,"action":"navigate","parameters":{"route":route}}
    if intent=="demand_forecast":
        demand=await _answer_demand_forecast(f"{product or query} demand forecast",f"{product or query} demand forecast".lower(),language)
        return demand or {"reply":"Which product should I forecast demand for?","intent":"demand_forecast","data":None}
    if intent=="marketplace_statistics":
        result=await DataAssistantService._answer_market_stats(query, query.lower(), language, user)
        return {"reply":result["reply"],"intent":"marketplace_statistics","data":result.get("data")}
    if intent=="delivery_information":
        return {"reply":PROJECT_SCOPE_RESPONSES[language]["delivery"],"intent":"delivery_information","data":None}
    if intent=="traceability":
        return {"reply":PROJECT_SCOPE_RESPONSES[language]["traceability"],"intent":"traceability","data":None}
    if intent=="project_information":
        return {"reply":_project_knowledge_reply(query.lower(),language) or PROJECT_SCOPE_RESPONSES[language]["help"],"intent":"project_knowledge","data":None}
    return {"reply":PROJECT_SCOPE_RESPONSES[language]["help"],"intent":"project_help","data":None}

class DataAssistantService:

    @staticmethod
    async def semantic_answer(message: str, language: str = "english", user: Optional[Dict[str, Any]] = None, conversation: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Use an LLM to understand natural language, then execute controlled AgriConnect operations."""
        lang=language.lower() if language else "english"
        if lang not in HELP_RESPONSES: lang="english"
        text=(message or "").strip()
        if not text: return {"action":"chat_reply","response":HELP_RESPONSES[lang]["default"],"intent":"default","data":None}
        low=text.lower()
        if any(k in low for k in ["password","otp","private address","payment details","wallet balance","my order","my orders","another user","other user"]):
            return {"action":"chat_reply","response":PRIVATE_DATA_RESPONSE[lang],"intent":"private_data_blocked","data":None}
        plan=await _semantic_plan(text,conversation)
        if not plan:
            # The scratch LLM is the semantic layer. Do not silently fall back
            # to keyword QA because that can answer a different question.
            return {
                "action": "chat_reply",
                "response": "The AgriConnect AI model is not ready yet. Start the local model by training it with: python scripts/train_agriconnect_llm.py --epochs 8 --batch-size 8",
                "intent": "semantic_unavailable",
                "data": None,
            }
        results=[await _execute_semantic_request(i,lang,user) for i in plan.get("requests",[])[:5] if isinstance(i,dict)]
        if not results: return {"action":"chat_reply","response":PROJECT_SCOPE_RESPONSES[lang]["help"],"intent":"project_help","data":None}
        combined="\n\n".join(r.get("reply","") for r in results if r.get("reply"))
        all_data=[x for r in results if isinstance(r.get("data"),list) for x in r["data"]]
        navigation=next((r.get("parameters") for r in results if r.get("action")=="navigate"),None)
        intents=[r.get("intent") for r in results]
        ui_actions=[]
        for r in results:
            if r.get("action")=="navigate" and r.get("parameters"):
                ui_actions.append({"type":"navigate","label":r["parameters"].get("label") or "Open page","route":r["parameters"].get("route")})
            for p in (r.get("data") if isinstance(r.get("data"),list) else []):
                if p.get("_id") or p.get("id"):
                    pid=_allowed_product_id(p.get("_id") or p.get("id"))
                    if pid:
                        ui_actions.append({"type":"product","label":"View & Buy","route":f"/product/{pid}","productId":pid})
        return {"action":"navigate" if navigation else "chat_reply","response":combined,"parameters":navigation or {"intents":intents,"uiActions":ui_actions},"intent":intents[0] if len(intents)==1 else "multi_request","data":all_data or None,"uiActions":ui_actions}

    @staticmethod
    async def answer(message: str, language: str = "english", user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        lang = language.lower() if language else "english"
        if lang not in HELP_RESPONSES:
            lang = "english"

        text = (message or "").strip()
        if not text:
            return {"reply": HELP_RESPONSES[lang]["default"], "language": lang, "intent": "default", "data": None}

        low = text.lower()

        if any(w in low for w in ["hi ", "hi", "hello", "hey ", "hey", "namaste", "vanakkam", "வணக்கம்", "नमस्ते"]):
            if len(text) <= 30:
                return {"reply": GREETING_RESPONSES[lang], "language": lang, "intent": "greeting", "data": None}

        if any(w in low for w in ["thank", "thanks", "நன்றி", "धन्यवाद"]):
            return {"reply": THANKS_RESPONSES[lang], "language": lang, "intent": "thanks", "data": None}

        private_request = (
            await DataAssistantService._detect_my_orders(low)
            or await DataAssistantService._detect_my_wallet(low)
            or await DataAssistantService._detect_my_inventory(low)
            or bool(_extract_order_number(text))
            or any(k in low for k in [
                "payment details", "payment information", "transaction details",
                "account details", "address", "phone number", "email address",
                "password", "otp", "private data", "another user", "other user",
                "customer details", "farmer details", "personal details",
            ])
        )
        if private_request:
            return {"reply": PRIVATE_DATA_RESPONSE.get(lang, PRIVATE_DATA_RESPONSE["english"]),
                    "language": lang, "intent": "private_data_blocked", "data": None}

        demand_reply = await _answer_demand_forecast(text, low, lang)
        if demand_reply:
            return demand_reply

        project_reply = _project_knowledge_reply(low, lang)
        if project_reply:
            return {"reply": project_reply, "language": lang, "intent": "project_knowledge", "data": None}

        # Personal order/wallet/inventory handlers are intentionally excluded.
        handlers = [
            ("market_stats", DataAssistantService._detect_market_stats, DataAssistantService._answer_market_stats),
            ("farmer_list", DataAssistantService._detect_farmer_list, DataAssistantService._answer_farmer_list),
            ("categories", DataAssistantService._detect_categories, DataAssistantService._answer_categories),
            ("howto", DataAssistantService._detect_howto, DataAssistantService._answer_howto),
            ("product_price", DataAssistantService._detect_product_price, DataAssistantService._answer_product_price),
            ("cheapest", DataAssistantService._detect_cheapest, DataAssistantService._answer_cheapest),
            ("top_products", DataAssistantService._detect_top_products, DataAssistantService._answer_top_products),
            ("product_search", DataAssistantService._detect_product_search, DataAssistantService._answer_product_search),
        ]

        for intent, detect, handler in handlers:
            if await detect(low):
                return await handler(text, low, lang, user)

        return {"reply": PROJECT_SCOPE_RESPONSES[lang]["help"], "language": lang, "intent": "project_help", "data": None}

    # ---------- detection ----------

    @staticmethod
    async def _detect_my_orders(low: str) -> bool:
        return any(w in low for w in [
            "my order", "my orders", "order status", "track order", "track my order",
            "my recent order", "my last order", "status of my order", "என் ஆர்டர்", "मेरा ऑर्डर",
        ])

    @staticmethod
    async def _detect_my_wallet(low: str) -> bool:
        return any(w in low for w in [
            "my wallet", "wallet balance", "my balance", "my earnings", "my money",
            "how much money", "payout", "withdrawal", "என் வாலட்", "मेरा वॉलेट",
        ])

    @staticmethod
    async def _detect_my_inventory(low: str) -> bool:
        return any(w in low for w in [
            "my stock", "my inventory", "my products", "stock level", "low stock",
            "out of stock", "என் இருப்பு", "मेरा स्टॉक",
        ])

    @staticmethod
    async def _detect_market_stats(low: str) -> bool:
        return any(w in low for w in [
            "how many products", "total products", "total farmers", "how many farmers",
            "total orders", "how many orders", "total revenue", "total sales",
            "marketplace stats", "platform stats", "how many users", "total users",
            "summary", "how many", "how much revenue", "stats", "எத்தனை", "कुल",
        ])

    @staticmethod
    async def _detect_farmer_list(low: str) -> bool:
        return any(w in low for w in [
            "list farmers", "show farmers", "farmers near", "nearby farmers", "top farmers",
            "who sells", "farmers", "producers", "sellers", "விவசாயிகள்", "किसान",
        ])

    @staticmethod
    async def _detect_categories(low: str) -> bool:
        return any(w in low for w in [
            "categories", "what do you sell", "product categories", "what products",
            "what do you have", "வகைகள்", "श्रेणियां",
        ])

    @staticmethod
    async def _detect_howto(low: str) -> bool:
        return any(w in low for w in [
            "how to", "how do i", "how does", "how can", "register", "sign up",
            "upload product", "add product", "payment method", "how to pay",
            "delivery option", "how does delivery", "sell", "start selling",
            "எப்படி", "कैसे", "पंजीकरण", "अपलोड",
        ])

    @staticmethod
    async def _detect_product_price(low: str) -> bool:
        return any(w in low for w in [
            "price of", "what is the price", "how much is", "rate of", "cost of",
            "price for", "price", "விலை", "कीमत", "दाम", "how much does",
        ])

    @staticmethod
    async def _detect_cheapest(low: str) -> bool:
        return any(w in low for w in [
            "cheapest", "most expensive", "cheap", "affordable", "best price",
            "lowest price", "highest price", "மலிவான", "सस्ता",
        ])

    @staticmethod
    async def _detect_top_products(low: str) -> bool:
        return any(w in low for w in [
            "featured", "top rated", "best", "popular", "recommended", "top product",
            "top products", "trending", "bestseller", "சிறந்த", "शीर्ष",
        ])

    @staticmethod
    async def _detect_product_search(low: str) -> bool:
        return any(w in low for w in [
            "find", "search", "buy", "show", "list", "available", "order", "vegetable",
            "vegetables", "fruit", "fruits", "produce", "products", "organic", "fresh",
            "கிடைக்கும்", "सब्जी", "खोजें",
        ]) or any(p in low for p in PRODUCT_KEYWORDS)

    # ---------- handlers ----------

    @staticmethod
    async def _answer_order_by_number(order_number: str, lang: str) -> Dict[str, Any]:
        from app.repositories.order_repository import order_repository
        order = await order_repository.get_by_order_number(order_number)
        if not order:
            return {
                "reply": f"I couldn't find order {order_number}. Double-check the number or contact support.",
                "language": lang, "intent": "order_tracking", "data": None,
            }

        items = []
        for item in order.get("items", [])[:5]:
            qty = item.get("quantity", 0)
            name = item.get("productName", "Item")
            unit = item.get("unit", "")
            items.append(f"{name} × {qty}{unit}")
        item_text = ", ".join(items) if items else "N/A"

        status = order.get("orderStatus", "unknown").replace("_", " ")
        amount = _fmt_rs(order.get("totalAmount", 0))
        reply = (
            f"Order {order_number} is {status}.\n"
            f"Items: {item_text}\n"
            f"Total: {amount}"
        )
        if order.get("paymentStatus"):
            reply += f"\nPayment: {order.get('paymentStatus')}"
        if order.get("deliveredAt"):
            reply += f"\nDelivered on: {order.get('deliveredAt').strftime('%d %b %Y')}"
        return {"reply": reply, "language": lang, "intent": "order_tracking", "data": order}

    @staticmethod
    async def _answer_my_orders(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not user:
            return {"reply": "Please sign in to see your orders.", "language": lang, "intent": "my_orders", "data": None}

        from app.repositories.order_repository import order_repository
        user_id = str(user.get("_id"))
        role = user.get("role", "customer")

        if role == "customer":
            orders = await order_repository.get_by_customer(user_id, limit=5)
        elif role == "farmer":
            orders = await order_repository.get_by_farmer(user_id, limit=5)
        else:
            return {"reply": "Your account type does not have personal orders.", "language": lang, "intent": "my_orders", "data": None}

        if not orders:
            return {"reply": "You have no orders yet. Explore the marketplace to place your first order!", "language": lang, "intent": "my_orders", "data": None}

        lines = ["Here are your recent orders:"]
        for o in orders:
            status = o.get("orderStatus", "unknown").replace("_", " ")
            num = o.get("orderNumber", "")
            amount = _fmt_rs(o.get("totalAmount", 0))
            created = o.get("orderDate") or o.get("createdAt")
            date = created.strftime("%d %b") if created else ""
            lines.append(f"• {num} — {status} — {amount} ({date})")
        reply = "\n".join(lines)

        if any(w in low for w in ["status", "track", "last order", "recent"]):
            latest = orders[0]
            items = ", ".join(
                f"{i.get('productName', 'Item')} ×{i.get('quantity', 0)}" for i in latest.get("items", [])[:4]
            )
            reply += (
                f"\n\nLatest order {latest.get('orderNumber', '')} is "
                f"'{latest.get('orderStatus', 'unknown').replace('_', ' ')}'."
                + (f"\nItems: {items}" if items else "")
            )

        return {"reply": reply, "language": lang, "intent": "my_orders", "data": orders}

    @staticmethod
    async def _answer_my_wallet(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not user:
            return {"reply": "Please sign in to see your wallet.", "language": lang, "intent": "my_wallet", "data": None}

        from app.repositories.wallet_repository import wallet_repository
        wallet = await wallet_repository.get_by_user_id(str(user.get("_id")))
        if not wallet:
            return {"reply": "You don't have a wallet yet. Your wallet opens when you complete your first transaction.", "language": lang, "intent": "my_wallet", "data": None}

        balance = wallet.get("balance", 0)
        role = user.get("role", "")
        if role == "farmer":
            return {
                "reply": f"Your total earnings are {_fmt_rs(balance)}.",
                "language": lang,
                "intent": "my_wallet",
                "data": {"balance": balance},
            }
        return {
            "reply": f"Your current wallet balance is {_fmt_rs(balance)}.",
            "language": lang,
            "intent": "my_wallet",
            "data": {"balance": balance},
        }

    @staticmethod
    async def _answer_my_inventory(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not user or user.get("role") != "farmer":
            return {"reply": "Inventory details are available for farmer accounts only.", "language": lang, "intent": "my_inventory", "data": None}

        from app.repositories.inventory_repository import inventory_repository
        from app.repositories.product_repository import product_repository

        rows = await inventory_repository.get_by_farmer(str(user.get("_id")))
        if not rows:
            return {"reply": "You have no inventory records yet. Add products to create stock entries.", "language": lang, "intent": "my_inventory", "data": None}

        low_stock_only = any(w in low for w in ["low stock", "out of stock", "low"])
        lines = []
        for row in rows[:10]:
            product_id = row.get("product_id")
            product = await product_repository.get_by_id(product_id) if product_id else None
            name = (product or {}).get("name", "Unknown product")
            total = row.get("total_stock", 0)
            reserved = row.get("reserved_stock", 0)
            sold = row.get("sold_stock", 0)
            available = max(0, total - reserved - sold)
            unit = row.get("unit", "kg")
            if low_stock_only and available > 10:
                continue
            flag = " ⚠ low" if available <= 10 else ""
            lines.append(f"• {name} — {available} {unit} available{flag}")

        if not lines:
            return {"reply": "Great news — none of your products are running low on stock.", "language": lang, "intent": "my_inventory", "data": None}

        header = "Products running low on stock:" if low_stock_only else "Your current stock:"
        return {"reply": header + "\n" + "\n".join(lines), "language": lang, "intent": "my_inventory", "data": rows}

    @staticmethod
    async def _answer_market_stats(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        from app.repositories.product_repository import product_repository
        from app.repositories.order_repository import order_repository
        from app.repositories.user_repository import user_repository

        want_revenue = "revenue" in low or "sales" in low or "earned" in low

        total_products = await product_repository.count({
            "deletedAt": None, "isActive": True, "isBasketOnly": {"$ne": True},
        })
        total_farmers = await user_repository.count({"role": "farmer", "deletedAt": None, "isActive": True})
        total_customers = await user_repository.count({"role": "customer", "deletedAt": None, "isActive": True})
        total_orders = await order_repository.count({"deletedAt": None})

        parts = [f"Here's the current marketplace snapshot:\n• {total_products} active products\n• {total_farmers} farmers\n• {total_customers} customers\n• {total_orders} total orders"]

        if want_revenue:
            delivered = await order_repository.find_many({"orderStatus": "delivered", "deletedAt": None}, limit=1000)
            revenue = sum(float(o.get("totalAmount", 0) or 0) for o in delivered)
            parts.append(f"• {_fmt_rs(revenue)} revenue from delivered orders")

        return {"reply": "\n".join(parts), "language": lang, "intent": "market_stats", "data": None}

    @staticmethod
    async def _answer_farmer_list(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        from app.repositories.user_repository import user_repository
        from app.repositories.product_repository import product_repository

        farmers = await user_repository.get_users_by_role("farmer", limit=15)
        if not farmers:
            return {"reply": "No farmers are registered yet.", "language": lang, "intent": "farmer_list", "data": None}

        looking_for = None
        for p in PRODUCT_KEYWORDS:
            if p in low and p not in {"produce", "vegetable", "vegetables", "fruit", "fruits", "grains", "pulses", "spices"}:
                looking_for = p
                break
        if not looking_for:
            for token in _clean_keywords(text):
                if token in {"farmers", "farmer", "who", "sells", "show", "list", "near", "nearby", "top", "buy", "from"}:
                    continue
                looking_for = token
                break

        if looking_for:
            products = await product_repository.find_many(
                {"deletedAt": None, "isActive": True, "isBasketOnly": {"$ne": True}},
                limit=50,
            )
            matched = [p for p in products if looking_for in ((p.get("name") or "").lower() + " " + (p.get("farmerName") or "").lower())]
            if matched:
                seller_names = []
                seen = set()
                for p in matched:
                    farm = p.get("farmerName") or p.get("farmName") or "Local Farmer"
                    if farm not in seen:
                        seen.add(farm)
                        seller_names.append(farm)
                reply = f"Farmers currently selling {looking_for.title()}:\n" + "\n".join(f"• {f}" for f in seller_names[:10])
                return {"reply": reply, "language": lang, "intent": "farmer_list", "data": matched}

        names = []
        for f in farmers[:10]:
            name = f"{f.get('firstName', '')} {f.get('lastName', '')}".strip() or f.get("email", "Farmer")
            city = f.get("city") or ""
            names.append(f"• {name}" + (f" ({city})" if city else ""))
        reply = f"There are {len(farmers)} registered farmers. Here are some:\n" + "\n".join(names)
        return {"reply": reply, "language": lang, "intent": "farmer_list", "data": farmers}

    @staticmethod
    async def _answer_categories(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        from app.repositories.category_repository import category_repository
        categories = await category_repository.get_all_categories()
        if not categories:
            return {"reply": "No product categories are configured yet.", "language": lang, "intent": "categories", "data": None}
        names = [c.get("name", "Category") for c in categories]
        reply = "The marketplace has these categories:\n" + "\n".join(f"• {n}" for n in names[:15])
        return {"reply": reply, "language": lang, "intent": "categories", "data": categories}

    @staticmethod
    async def _answer_howto(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        responses = HELP_RESPONSES[lang]
        intent = "how"
        if any(w in low for w in ["register", "sign up", "create account", "पंजीकरण", "பதிவு"]):
            intent = "register"
        elif any(w in low for w in ["upload", "add product", "add a product", "add products", "अपलोड", "தயாரிப்பு"]):
            intent = "upload"
        elif any(w in low for w in ["payment", "pay", "upi", "card", "भुगतान", "கட்டணம்"]):
            intent = "payment"
        elif any(w in low for w in ["delivery", "deliver", "शिप", "डिलीवरी", "டெலிவரி"]):
            intent = "delivery"
        elif any(w in low for w in ["price", "sell", "rate", "मूल्य", "விலை"]):
            intent = "price"
        return {"reply": responses[intent], "language": lang, "intent": f"howto_{intent}", "data": None}

    @staticmethod
    async def _answer_product_price(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        from app.repositories.product_repository import product_repository

        product = None
        for p in sorted(PRODUCT_KEYWORDS, key=len, reverse=True):
            if p in low:
                product = p
                break
        if not product:
            for token in _clean_keywords(text):
                if token in {"price", "of", "what", "how", "much", "is", "cost", "rate", "for", "tell", "me"}:
                    continue
                product = token
                break

        if not product:
            return {"reply": "Which product's price would you like to know? For example 'what is the price of rice?'.", "language": lang, "intent": "product_price", "data": None}

        products = await product_repository.find_many(
            {"deletedAt": None, "isActive": True, "isBasketOnly": {"$ne": True}},
            limit=100,
        )
        matched = [p for p in products if product in (p.get("name") or "").lower()]

        if not matched:
            return {"reply": f"I couldn't find '{product}' in the current marketplace. Try another product name.", "language": lang, "intent": "product_price", "data": None}

        lines = []
        for p in matched[:5]:
            name = p.get("name", product.title())
            price = _fmt_rs(p.get("price", 0))
            unit = p.get("unit", "kg")
            farm = p.get("farmerName") or p.get("farmName") or "Local Farmer"
            qty = p.get("quantity", 0)
            lines.append(f"• {name} — {price}/{unit} — {farm} ({qty} {unit} left)")
        reply = f"Current price of {product.title()}:\n" + "\n".join(lines)
        return {"reply": reply, "language": lang, "intent": "product_price", "data": matched}

    @staticmethod
    async def _answer_cheapest(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        from app.repositories.product_repository import product_repository

        is_cheap = any(w in low for w in ["cheapest", "cheap", "affordable", "best price", "lowest price", "low price", "மலிவான", "सस्ता"])
        sort_order = 1 if is_cheap else -1
        products = await product_repository.find_many(
            {"deletedAt": None, "isActive": True, "isBasketOnly": {"$ne": True}},
            limit=8,
            sort=[("price", sort_order)],
        )
        if not products:
            return {"reply": "No products are currently listed in the marketplace.", "language": lang, "intent": "cheapest", "data": None}

        label = "cheapest" if is_cheap else "most expensive"
        lines = [f"Here are the {label} products right now:"]
        for p in products:
            name = p.get("name", "Product")
            price = _fmt_rs(p.get("price", 0))
            unit = p.get("unit", "kg")
            lines.append(f"• {name} — {price}/{unit}")
        return {"reply": "\n".join(lines), "language": lang, "intent": "cheapest", "data": products}

    @staticmethod
    async def _answer_top_products(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        from app.repositories.product_repository import product_repository

        products = await product_repository.find_many(
            {"deletedAt": None, "isActive": True, "isBasketOnly": {"$ne": True}},
            limit=100,
            sort=[("ratings.average", -1), ("views", -1)],
        )
        if not products:
            return {"reply": "No products are currently listed in the marketplace.", "language": lang, "intent": "top_products", "data": None}

        lines = ["Here are the top-rated products on the marketplace:"]
        for p in products[:6]:
            name = p.get("name", "Product")
            price = _fmt_rs(p.get("price", 0))
            unit = p.get("unit", "kg")
            rating = ((p.get("ratings") or {}).get("average") or 0)
            rating_text = f" ★{rating}" if rating else ""
            lines.append(f"• {name} — {price}/{unit}{rating_text}")
        return {"reply": "\n".join(lines), "language": lang, "intent": "top_products", "data": products}

    @staticmethod
    async def _answer_product_search(text: str, low: str, lang: str, user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        from app.repositories.product_repository import product_repository

        products = await product_repository.find_many(
            {"deletedAt": None, "isActive": True, "isBasketOnly": {"$ne": True}},
            limit=80,
        )
        if not products:
            return {"reply": "No products are currently listed in the marketplace. Check back soon!", "language": lang, "intent": "product_search", "data": None}

        want_organic = any(w in low for w in ["organic", "ஆர்கானிக்", "जैविक"])
        want_fresh = any(w in low for w in ["fresh", "புதிய", "ताजा"])
        max_price = _extract_price(text)

        keywords = _clean_keywords(text)
        target = None
        for p in sorted(PRODUCT_KEYWORDS, key=len, reverse=True):
            if p in low:
                target = p
                break

        scored = []
        for p in products:
            name = (p.get("name") or "").lower()
            farm = ((p.get("farmerName") or p.get("farmName") or "") or "").lower()
            price = float(p.get("price", 0) or 0)

            if want_organic and not p.get("isOrganic"):
                continue
            if want_fresh and not p.get("isFresh"):
                continue
            if max_price is not None and price > max_price:
                continue

            score = 0
            if target:
                score += 3 if target in name else 0
            score += sum(1 for k in keywords if k in name or k in farm)
            if name == target:
                score += 5
            scored.append((score, price, p))

        scored.sort(key=lambda x: (-x[0], x[1]))
        matches = [p for s, price, p in scored if s > 0]
        if not matches:
            matches = [p for s, price, p in scored][:6]

        if not matches:
            return {"reply": "No products matched your search. Try different keywords or a higher price limit.", "language": lang, "intent": "product_search", "data": None}

        lines = ["Here is what's available right now from our marketplace:"]
        for p in matches[:6]:
            name = p.get("name", "Produce")
            price = _fmt_rs(p.get("price", 0))
            unit = p.get("unit", "kg")
            farm = p.get("farmerName") or p.get("farmName") or "Local Farmer"
            qty = p.get("quantity", 0)
            lines.append(f"• {name} — {price}/{unit} — {farm} ({qty} {unit} left)")
        lines.append("Prices are live from the database. View them on the Marketplace to order.")

        reply = "\n".join(lines)
        if max_price is not None:
            reply = f"Products {_fmt_rs(max_price)} or below:\n" + "\n".join(lines[1:])
        return {"reply": reply, "language": lang, "intent": "product_search", "data": matches}


data_assistant_service = DataAssistantService()