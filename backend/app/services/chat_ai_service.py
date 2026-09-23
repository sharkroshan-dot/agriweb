"""Rule-based chat assistance for AgriConnect messages.

There is no external LLM in this deployment, so suggested replies and
translation are driven by lightweight dictionaries + intent matching, matching
the pattern used by the existing ``DataAssistantService``. The farmer remains in
control: every suggestion is offered for edit/send rather than auto-sent.
"""
import re
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Phrase dictionaries used for quick reply translation. Keyed by language code.
PHRASES: Dict[str, Dict[str, str]] = {
    "english": {
        "fresh": "This batch was harvested recently and is marked Grade A, subject to the verification status shown on the product page.",
        "quality": "The current batch passed our quality checks. You can see the verification status on the product page.",
        "deliver_tomorrow": "Yes, I can deliver tomorrow. Please confirm the preferred time slot.",
        "time_slot": "We can deliver between 9 AM and 11 AM. Please confirm a slot.",
        "price": "The current price is ₹{{price}} per kg for this batch. Volume discounts are available.",
        "stock": "Yes, we have stock available today. I can reserve it for you.",
        "payment": "Payment is processed through AgriConnect at checkout for a secure transaction.",
        "pickup": "You can collect it from the farm pickup location during pickup hours.",
        "shipment": "Your order has been dispatched and will reach you on the scheduled date.",
        "greeting": "Hello! How can I help you with this order?",
        "thanks": "You're welcome! Let me know if you need anything else.",
        "default": "Thanks for your message. I'll get back to you shortly.",
    },
    "tamil": {
        "fresh": "இந்த தொகுதி சமீபத்தில் அறுவடை செய்யப்பட்டது மற்றும் தயாரிப்பு பக்கத்தில் காட்டப்பட்டுள்ள சரிபார்ப்பு நிலைக்கு உட்பட்டு A தரம் எனக் குறிக்கப்பட்டுள்ளது.",
        "quality": "தற்போதைய தொகுதி எங்கள் தர கட்டுப்பாட்டை கடந்துவிட்டது. சரிபார்ப்பு நிலையை தயாரிப்பு பக்கத்தில் பார்க்கலாம்.",
        "deliver_tomorrow": "ஆம், நாளை டெலிவரி செய்ய முடியும். விருப்பமான நேரத்தை உறுதிப்படுத்தவும்.",
        "time_slot": "காலை 9 மணி முதல் 11 மணி வரை டெலிவரி செய்யலாம். ஒரு நேரத்தை உறுதிப்படுத்தவும்.",
        "price": "தற்போதைய விலை ஒரு கிலோ ₹{{price}}. மொத்த வாங்கலுக்கு தள்ளுபடி உள்ளது.",
        "stock": "ஆம், இன்று பங்கு கிடைக்கிறது. உங்களுக்காக முன்பதிவு செய்யலாம்.",
        "payment": "பாதுகாப்பான பரிவர்த்தனைக்காக கட்டணம் செக்அவுட்டில் AgriConnect வழியாக செயலாக்கப்படுகிறது.",
        "pickup": "பண்ணை பிக்கப் இடத்திலிருந்து பிக்கப் நேரத்தில் பெற்றுக்கொள்ளலாம்.",
        "shipment": "உங்கள் ஆர்டர் அனுப்பப்பட்டுவிட்டது, திட்டமிட்ட தேதியில் உங்களை வந்தடையும்.",
        "greeting": "வணக்கம்! இந்த ஆர்டரில் உங்களுக்கு எப்படி உதவ முடியும்?",
        "thanks": "நன்றி! வேறு ஏதாவது தெரிந்துகொள்ள விரும்புகிறீர்களா?",
        "default": "உங்கள் செய்திக்கு நன்றி. விரைவில் உங்களுக்கு பதிலளிக்கிறேன்.",
    },
    "hindi": {
        "fresh": "यह बैच हाल ही में काटा गया है और उत्पाद पृष्ठ पर दिखाए गए सत्यापन स्थिति के अनुसार ग्रेड A है।",
        "quality": "वर्तमान बैच हमारे गुणवत्ता जांच में पास हुआ है। सत्यापन स्थिति उत्पाद पृष्ठ पर देखें।",
        "deliver_tomorrow": "हाँ, मैं कल डिलीवरी कर सकता हूँ। कृपया पसंदीदा समय की पुष्टि करें।",
        "time_slot": "हम सुबह 9 बजे से 11 बजे के बीच डिलीवरी कर सकते हैं। कृपया स्लॉट की पुष्टि करें।",
        "price": "इस बैच के लिए वर्तमान मूल्य ₹{{price}} प्रति किलो है। थोक खरीद पर छूट उपलब्ध है।",
        "stock": "हाँ, आज स्टॉक उपलब्ध है। मैं आपके लिए आरक्षित कर सकता हूँ।",
        "payment": "सुरक्षित लेनदेन के लिए भुगतान चेकआउट पर AgriConnect के माध्यम से संसाधित होता है।",
        "pickup": "आप इसे पिकअप समय के दौरान फार्म पिकअप स्थान से ले सकते हैं।",
        "shipment": "आपका ऑर्डर भेज दिया गया है और निर्धारित तिथि पर पहुंच जाएगा।",
        "greeting": "नमस्ते! इस ऑर्डर में मैं आपकी कैसे मदद कर सकता हूँ?",
        "thanks": "आपका स्वागत है! और कुछ चाहिए तो बताइए।",
        "default": "आपके संदेश के लिए धन्यवाद। मैं जल्द ही आपको जवाब दूँगा।",
    },
}

INTENT_PATTERNS: List[Dict[str, Any]] = [
    {"intent": "fresh", "patterns": [r"fresh", r"new\b", r"harvest", r"freshness", r"புதிய", r"ताजा"]},
    {"intent": "quality", "patterns": [r"quality", r"grade", r"good\b", r"ஒளி", r"गुणवत्ता"]},
    {"intent": "deliver_tomorrow", "patterns": [r"tomorrow", r"next day", r"morning", r"நாளை", r"कल"]},
    {"intent": "time_slot", "patterns": [r"time", r"slot", r"deliver.*when", r"when.*deliver", r"நேரம்", r"समय"]},
    {"intent": "price", "patterns": [r"price", r"cost", r"rate", r"charge", r"விலை", r"कीमत"]},
    {"intent": "stock", "patterns": [r"available", r"stock", r"have", r"கிடைக்க", r"उपलब्ध"]},
    {"intent": "payment", "patterns": [r"pay", r"payment", r"upi", r"cod", r"கட்டணம்", r"भुगतान"]},
    {"intent": "pickup", "patterns": [r"pickup", r"pick up", r"collect", r"பிக்கப்", r"पिकअप"]},
    {"intent": "shipment", "patterns": [r"dispatch", r"shipped", r"shipment", r"sent", r"அனுப்ப", r"भेज"]},
    {"intent": "greeting", "patterns": [r"^hi", r"^hello", r"^hey", r"vanakkam", r"வணக்கம்", r"नमस्ते"]},
    {"intent": "thanks", "patterns": [r"thank", r"thanks", r"நன்றி", r"धन्यवाद"]},
]

LANGUAGES = {"english": "en", "tamil": "ta", "hindi": "hi"}
SUPPORTED = list(LANGUAGES.keys())


def normalize_language(language: Optional[str]) -> str:
    lang = (language or "english").strip().lower()
    for key, code in LANGUAGES.items():
        if lang in (key, code):
            return key
    return "english"


def _detect_intent(text: str) -> str:
    low = (text or "").lower()
    for item in INTENT_PATTERNS:
        if any(re.search(p, low) for p in item["patterns"]):
            return item["intent"]
    return "default"


def suggest_replies(
    message: Optional[str],
    role: Optional[str] = None,
    language: str = "english",
    price: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """Return 2-3 editable suggested replies for the farmer to send."""
    lang = normalize_language(language)
    text = (message or "").strip()

    base_suggestions = []
    if text:
        intent = _detect_intent(text)
        template = PHRASES.get(lang, PHRASES["english"]).get(intent, PHRASES["english"]["default"])
        price_str = f"{price:,.2f}" if isinstance(price, (int, float)) else "35"
        suggested = template.replace("{{price}}", price_str)
        base_suggestions = [
            {"id": "ai-reply-1", "intent": intent, "content": suggested},
            {"id": "ai-reply-2", "intent": "thanks", "content": PHRASES.get(lang, PHRASES["english"])["thanks"]},
            {"id": "ai-reply-3", "intent": "default", "content": PHRASES.get(lang, PHRASES["english"])["default"]},
        ]
    else:
        base_suggestions = [
            {"id": "ai-reply-1", "intent": "greeting", "content": PHRASES.get(lang, PHRASES["english"])["greeting"]},
            {"id": "ai-reply-2", "intent": "stock", "content": PHRASES.get(lang, PHRASES["english"])["stock"]},
            {"id": "ai-reply-3", "intent": "default", "content": PHRASES.get(lang, PHRASES["english"])["default"]},
        ]

    # Role-specific polish for delivery threads.
    role_low = (role or "").lower()
    if role_low in ("delivery", "delivery_partner", "partner"):
        delivery_extra = PHRASES.get(lang, PHRASES["english"])
        base_suggestions.append(
            {"id": "ai-reply-4", "intent": "time_slot", "content": delivery_extra["time_slot"]}
        )

    # De-duplicate by content, cap at 3.
    seen = set()
    deduped = []
    for s in base_suggestions:
        if s["content"] not in seen:
            seen.add(s["content"])
            deduped.append(s)
        if len(deduped) >= 3:
            break
    return deduped


def translate_text(text: str, target_language: str, source_language: str = "english") -> Dict[str, Any]:
    """Translate a single message to the target language.

    Uses the phrase dictionary for known intents and a no-op fallback for
    arbitrary text. The response mirrors a translation API so it can be swapped
    for a real service later without changing the client contract.
    """
    target = normalize_language(target_language)
    source = normalize_language(source_language)
    text = (text or "").strip()
    if not text:
        return {
            "source_language": source,
            "target_language": target,
            "translated_text": "",
            "mode": "dictionary",
        }
    intent = _detect_intent(text)
    dictionary = PHRASES.get(target, PHRASES["english"])
    translated = dictionary.get(intent)
    if translated:
        return {
            "source_language": source,
            "target_language": target,
            "translated_text": translated,
            "mode": "dictionary",
            "intent": intent,
        }
    return {
        "source_language": source,
        "target_language": target,
        "translated_text": text,
        "mode": "passthrough",
    }
