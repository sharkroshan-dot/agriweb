"""Farmer Education Center: course catalogue, learning progress, AI content assistant and admin content tools."""
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.core.security import require_role
from app.database.mongodb import MongoDB

router = APIRouter()


def _user_id(user: dict) -> ObjectId:
    try:
        return ObjectId(str(user["_id"]))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid user session")


def _public(doc: dict) -> dict:
    row = dict(doc)
    row["id"] = str(row.pop("_id", row.get("id", "")))
    for key in ("createdBy", "farmerId", "userId", "courseId", "lessonId"):
        if isinstance(row.get(key), ObjectId):
            row[key] = str(row[key])
    return row


class ProgressBody(BaseModel):
    courseId: str
    lessonId: str
    status: str = Field(default="completed", pattern="^(not_started|in_progress|completed)$")
    language: str = Field(default="en", pattern="^(en|ta|hi)$")
    secondsViewed: int = Field(default=0, ge=0, le=86400)


class SavedBody(BaseModel):
    resourceId: str
    saved: bool = True


class AssistantBody(BaseModel):
    question: str = Field(min_length=3, max_length=1200)
    language: str = Field(default="en", pattern="^(en|ta|hi)$")
    crop: Optional[str] = Field(default=None, max_length=80)


class ActionPlanBody(BaseModel):
    courseId: str
    lessonId: str
    title: str = Field(max_length=180)
    tasks: list[dict[str, Any]] = Field(default_factory=list, max_length=30)


class TaskUpdateBody(BaseModel):
    completed: bool


class CourseBody(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    description: str = Field(min_length=10, max_length=2000)
    category: str = Field(min_length=2, max_length=80)
    level: str = Field(default="Beginner", max_length=40)
    estimatedMinutes: int = Field(default=30, ge=1, le=10000)
    language: str = Field(default="en", pattern="^(en|ta|hi)$")
    translations: dict[str, Any] = Field(default_factory=dict)
    published: bool = False


class LessonBody(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    summary: str = Field(default="", max_length=1000)
    content: str = Field(min_length=10, max_length=12000)
    order: int = Field(default=1, ge=1, le=500)
    estimatedMinutes: int = Field(default=10, ge=1, le=1000)
    language: str = Field(default="en", pattern="^(en|ta|hi)$")
    translations: dict[str, Any] = Field(default_factory=dict)
    videoUrl: Optional[str] = Field(default=None, max_length=1000)
    sourceName: Optional[str] = Field(default=None, max_length=180)
    sourceUrl: Optional[str] = Field(default=None, max_length=1000)
    actionTasks: list[str] = Field(default_factory=list, max_length=30)
    published: bool = False


# Initial learning content is deliberately practical and conservative. More
# detailed crop-specific prescriptions must be reviewed by an agronomist before publication.
SEED_COURSES = [
    {
        "slug": "soil-and-field-preparation", "title": "Soil health and field preparation",
        "description": "Understand soil testing, field preparation and safe organic matter management before planting.",
        "category": "Crop Management", "level": "Beginner", "estimatedMinutes": 30,
        "translations": {"ta": {"title": "மண் வளம் மற்றும் வயல் தயாரிப்பு", "description": "நடவு செய்வதற்கு முன் மண் பரிசோதனை மற்றும் வயல் தயாரிப்பை அறிக."}, "hi": {"title": "मिट्टी का स्वास्थ्य और खेत की तैयारी", "description": "बुवाई से पहले मिट्टी परीक्षण और खेत की तैयारी समझें।"}},
        "lessons": [
            {"title": "Start with a soil test", "summary": "Why soil testing is the first step.", "content": "A soil test helps identify soil pH and nutrient status. Collect a representative sample using the method recommended by your local soil testing laboratory. Keep samples from visibly different areas separate. Follow the laboratory report and local agricultural university guidance; do not apply fertilizer only by guesswork.", "translations": {"ta": {"title": "மண் பரிசோதனையுடன் தொடங்குங்கள்", "summary": "மண் பரிசோதனை ஏன் முக்கியம்.", "content": "மண் பரிசோதனை மண்ணின் pH மற்றும் ஊட்டச்சத்து நிலையை அறிய உதவும். உங்கள் உள்ளூர் மண் பரிசோதனை ஆய்வகம் பரிந்துரைக்கும் முறையில் மாதிரி எடுக்கவும். வேறுபட்ட பகுதிகளின் மாதிரிகளை தனியாக வைத்திருக்கவும். ஆய்வக அறிக்கை மற்றும் உள்ளூர் வேளாண் பல்கலைக்கழக ஆலோசனையைப் பின்பற்றவும்."}, "hi": {"title": "मिट्टी परीक्षण से शुरुआत करें", "summary": "मिट्टी परीक्षण क्यों महत्वपूर्ण है।", "content": "मिट्टी परीक्षण से pH और पोषक तत्वों की स्थिति पता चलती है। स्थानीय मिट्टी परीक्षण प्रयोगशाला की विधि के अनुसार प्रतिनिधि नमूना लें। अलग-अलग क्षेत्रों के नमूने अलग रखें और प्रयोगशाला की रिपोर्ट तथा स्थानीय कृषि विशेषज्ञ की सलाह का पालन करें।"}}, "actionTasks": ["Find a local soil testing laboratory", "Collect a representative soil sample", "Save the soil test report"]},
            {"title": "Prepare the field safely", "summary": "Plan field preparation around soil and crop needs.", "content": "Remove unwanted material and plan drainage before planting. Use well-decomposed compost or manure only when suitable for the crop and local conditions. Avoid working very wet soil because it can damage soil structure. Follow recommended land preparation practices for your crop and soil type.", "translations": {"ta": {"title": "வயலை பாதுகாப்பாக தயாரிக்கவும்", "summary": "மண் மற்றும் பயிர் தேவைக்கு ஏற்ப திட்டமிடுங்கள்.", "content": "நடவு செய்வதற்கு முன் தேவையற்ற பொருட்களை அகற்றி நீர் வடிகால் ஏற்பாடுகளை திட்டமிடுங்கள். பயிருக்கும் உள்ளூர் சூழலுக்கும் ஏற்ற நன்கு மக்கிய உரத்தை மட்டும் பயன்படுத்தவும். மண் மிகவும் ஈரமாக இருக்கும்போது உழுவதைத் தவிர்க்கவும். பயிர் மற்றும் மண் வகைக்கு ஏற்ற பரிந்துரைகளைப் பின்பற்றவும்."}, "hi": {"title": "खेत को सुरक्षित रूप से तैयार करें", "summary": "मिट्टी और फसल की जरूरत के अनुसार योजना बनाएं।", "content": "बुवाई से पहले अवांछित सामग्री हटाएं और जल निकासी की योजना बनाएं। फसल और स्थानीय परिस्थितियों के अनुसार अच्छी तरह सड़ी खाद का उपयोग करें। बहुत गीली मिट्टी में जुताई से बचें और स्थानीय कृषि सलाह का पालन करें।"}}, "actionTasks": ["Check field drainage", "Plan suitable organic matter use", "Prepare a crop-specific field schedule"]},
        ],
    },
    {
        "slug": "water-smart-irrigation", "title": "Water-smart irrigation",
        "description": "Learn how to observe crop water needs, check irrigation systems and reduce avoidable water loss.",
        "category": "Irrigation", "level": "Beginner", "estimatedMinutes": 25,
        "translations": {"ta": {"title": "நீர் சிக்கன பாசனம்", "description": "பயிரின் நீர் தேவையை அறிந்து நீர் வீணாவதை குறைக்க கற்றுக்கொள்ளுங்கள்."}, "hi": {"title": "जल-कुशल सिंचाई", "description": "फसल की पानी की जरूरत समझें और पानी की बर्बादी कम करें।"}},
        "lessons": [
            {"title": "Observe crop water needs", "summary": "Use soil and crop observations before irrigation.", "content": "Irrigation frequency depends on crop, growth stage, soil texture, weather and drainage. Check soil moisture in the root zone and observe the crop. Avoid a fixed schedule that ignores rainfall or waterlogging. For crop-specific intervals, use advice from your local agricultural extension service.", "translations": {"ta": {"title": "பயிரின் நீர் தேவையை கவனிக்கவும்", "summary": "பாசனத்திற்கு முன் மண் மற்றும் பயிரை கவனிக்கவும்.", "content": "பாசன இடைவெளி பயிர், வளர்ச்சி நிலை, மண் தன்மை, வானிலை மற்றும் வடிகால் ஆகியவற்றைப் பொறுத்தது. வேர் பகுதியில் மண் ஈரத்தைப் பார்த்து பயிரை கவனிக்கவும். மழை அல்லது நீர் தேக்கம் உள்ளபோது ஒரே நிரந்தர அட்டவணையைப் பின்பற்ற வேண்டாம். குறிப்பிட்ட பயிர் ஆலோசனைக்கு உள்ளூர் வேளாண் அலுவலரை அணுகவும்."}, "hi": {"title": "फसल की पानी की जरूरत देखें", "summary": "सिंचाई से पहले मिट्टी और फसल का निरीक्षण करें।", "content": "सिंचाई का अंतराल फसल, विकास अवस्था, मिट्टी, मौसम और जल निकासी पर निर्भर करता है। जड़ क्षेत्र की नमी देखें और फसल का निरीक्षण करें। बारिश या जलभराव को नजरअंदाज करके तय समय-सारणी न अपनाएं। फसल-विशिष्ट सलाह स्थानीय कृषि सेवा से लें।"}}, "actionTasks": ["Check root-zone soil moisture", "Inspect irrigation lines for leaks", "Record irrigation and rainfall"]},
            {"title": "Maintain a drip system", "summary": "Basic inspection for even water delivery.", "content": "Inspect filters, pipes and emitters regularly. Flush lines according to the equipment manual and check for blocked or damaged emitters. Repair leaks and confirm that water reaches plants evenly. Follow the manufacturer's safety and maintenance instructions.", "translations": {"ta": {"title": "சொட்டு நீர் அமைப்பை பராமரிக்கவும்", "summary": "சீரான நீர் விநியோகத்திற்கான அடிப்படை பரிசோதனை.", "content": "வடிகட்டிகள், குழாய்கள் மற்றும் சொட்டிகளை முறையாக பரிசோதிக்கவும். கருவி கையேட்டின்படி குழாய்களை சுத்தம் செய்து அடைப்பு அல்லது சேதமடைந்த சொட்டிகளை சரிபார்க்கவும். கசிவுகளை சரிசெய்து அனைத்து செடிகளுக்கும் சமமாக நீர் கிடைக்கிறதா என உறுதிப்படுத்தவும்."}, "hi": {"title": "ड्रिप प्रणाली का रखरखाव करें", "summary": "समान पानी वितरण के लिए बुनियादी जांच।", "content": "फिल्टर, पाइप और ड्रिपर की नियमित जांच करें। उपकरण पुस्तिका के अनुसार लाइन फ्लश करें और बंद या क्षतिग्रस्त ड्रिपर देखें। रिसाव ठीक करें और समान पानी वितरण सुनिश्चित करें।"}}, "actionTasks": ["Inspect filter and pipes", "Check emitters for blockage", "Record repairs and maintenance"]},
        ],
    },
    {
        "slug": "safe-pest-monitoring", "title": "Safe pest monitoring and prevention",
        "description": "Learn to monitor crops, record symptoms and seek verified advice before applying crop protection products.",
        "category": "Pest Management", "level": "Beginner", "estimatedMinutes": 30,
        "translations": {"ta": {"title": "பாதுகாப்பான பூச்சி கண்காணிப்பு", "description": "பயிரை கண்காணித்து சரிபார்க்கப்பட்ட ஆலோசனையைப் பெற கற்றுக்கொள்ளுங்கள்."}, "hi": {"title": "सुरक्षित कीट निगरानी और रोकथाम", "description": "फसल की निगरानी करें और उपचार से पहले सत्यापित सलाह लें।"}},
        "lessons": [
            {"title": "Scout and record symptoms", "summary": "Observe before deciding what action to take.", "content": "Inspect a number of plants across the field, including field edges and interior areas. Record the crop stage, affected plant parts, pattern of damage and date. Take clear photographs in natural light. Similar symptoms can have different causes, so do not diagnose from one symptom alone.", "translations": {"ta": {"title": "அறிகுறிகளை கவனித்து பதிவு செய்யுங்கள்", "summary": "நடவடிக்கை எடுப்பதற்கு முன் கவனியுங்கள்.", "content": "வயலின் ஓரங்களிலும் நடுப்பகுதியிலும் பல செடிகளைப் பார்வையிடுங்கள். பயிரின் வளர்ச்சி நிலை, பாதிக்கப்பட்ட பகுதி, சேதத்தின் தன்மை மற்றும் தேதியை பதிவு செய்யுங்கள். இயற்கை வெளிச்சத்தில் தெளிவான படங்களை எடுக்கவும். ஒரே அறிகுறிக்கு பல காரணங்கள் இருக்கலாம்; ஒரு அறிகுறியை மட்டும் வைத்து நோயறிதல் செய்ய வேண்டாம்."}, "hi": {"title": "लक्षणों का निरीक्षण और रिकॉर्ड करें", "summary": "कार्रवाई तय करने से पहले निरीक्षण करें।", "content": "खेत के किनारों और अंदर कई पौधों का निरीक्षण करें। फसल अवस्था, प्रभावित भाग, नुकसान का पैटर्न और तारीख लिखें। प्राकृतिक रोशनी में साफ तस्वीरें लें। एक जैसे लक्षणों के अलग कारण हो सकते हैं, इसलिए केवल एक लक्षण से निदान न करें।"}}, "actionTasks": ["Inspect plants in multiple field areas", "Photograph and record symptoms", "Ask a qualified local expert to confirm diagnosis"]},
            {"title": "Choose safe next steps", "summary": "Use integrated pest management principles.", "content": "Start with field sanitation, monitoring and prevention practices appropriate to the crop. Confirm pest identity and local threshold guidance with an agricultural extension officer before treatment. If a pesticide is recommended, use only a product registered for the crop and target pest, follow the label, protective equipment, pre-harvest interval and local regulations. Never mix products unless the label explicitly permits it.", "translations": {"ta": {"title": "பாதுகாப்பான அடுத்த நடவடிக்கைகளைத் தேர்வு செய்யுங்கள்", "summary": "ஒருங்கிணைந்த பூச்சி மேலாண்மை முறைகளைப் பயன்படுத்துங்கள்.", "content": "பயிருக்கு ஏற்ற வயல் சுத்தம், கண்காணிப்பு மற்றும் தடுப்பு முறைகளுடன் தொடங்குங்கள். சிகிச்சைக்கு முன் வேளாண் அலுவலரிடம் பூச்சி அடையாளம் மற்றும் உள்ளூர் வரம்பை உறுதிப்படுத்துங்கள். பூச்சிக்கொல்லி பரிந்துரைக்கப்பட்டால் அந்த பயிருக்கும் பூச்சிக்கும் பதிவு செய்யப்பட்ட பொருளை மட்டும் லேபிள், பாதுகாப்பு உபகரணங்கள் மற்றும் அறுவடைக்கு முன் காத்திருப்பு காலம் ஆகியவற்றைப் பின்பற்றி பயன்படுத்தவும்."}, "hi": {"title": "सुरक्षित अगले कदम चुनें", "summary": "एकीकृत कीट प्रबंधन के सिद्धांत अपनाएं।", "content": "फसल के अनुसार खेत की सफाई, निगरानी और रोकथाम से शुरुआत करें। उपचार से पहले कृषि अधिकारी से कीट की पहचान और स्थानीय सीमा की पुष्टि करें। कीटनाशक सुझाए जाने पर केवल पंजीकृत उत्पाद का लेबल, सुरक्षा उपकरण और कटाई-पूर्व अंतराल का पालन करें।"}}, "actionTasks": ["Remove and dispose of affected plant material safely if advised", "Confirm pest identity with an expert", "Read the full product label before any treatment"]},
        ],
    },
    {
        "slug": "farm-business-and-digital-selling", "title": "Farm business and digital selling",
        "description": "Improve product listings, quality communication, order preparation and customer service.",
        "category": "Farm Business", "level": "Beginner", "estimatedMinutes": 25,
        "translations": {"ta": {"title": "பண்ணை வணிகம் மற்றும் டிஜிட்டல் விற்பனை", "description": "தயாரிப்பு பட்டியல், தரம், ஆர்டர் தயாரிப்பு மற்றும் வாடிக்கையாளர் சேவையை மேம்படுத்துங்கள்."}, "hi": {"title": "कृषि व्यवसाय और डिजिटल बिक्री", "description": "उत्पाद सूची, गुणवत्ता, ऑर्डर तैयारी और ग्राहक सेवा सुधारें।"}},
        "lessons": [
            {"title": "Create a clear product listing", "summary": "Help buyers understand what you sell.", "content": "Use a clear product name, accurate unit, available quantity, harvest or availability date and honest quality description. Add recent photographs of the actual produce. Update stock when quantities change so buyers do not order unavailable produce.", "translations": {"ta": {"title": "தெளிவான தயாரிப்பு பட்டியலை உருவாக்குங்கள்", "summary": "நீங்கள் விற்பதை வாங்குபவர்கள் புரிந்துகொள்ள உதவுங்கள்.", "content": "தெளிவான தயாரிப்பு பெயர், சரியான அலகு, கிடைக்கும் அளவு, அறுவடை அல்லது கிடைக்கும் தேதி மற்றும் உண்மையான தர விவரத்தை குறிப்பிடுங்கள். உண்மையான விளைபொருளின் சமீபத்திய படங்களைச் சேர்க்கவும். இருப்பு மாறும்போது புதுப்பிக்கவும்."}, "hi": {"title": "स्पष्ट उत्पाद सूची बनाएं", "summary": "खरीदारों को उत्पाद समझने में मदद करें।", "content": "स्पष्ट उत्पाद नाम, सही इकाई, उपलब्ध मात्रा, उपलब्धता तिथि और सटीक गुणवत्ता विवरण दें। वास्तविक उपज की हाल की तस्वीरें जोड़ें। मात्रा बदलने पर स्टॉक अपडेट करें।"}}, "actionTasks": ["Review product title and unit", "Update available quantity", "Upload recent produce photographs"]},
            {"title": "Prepare and communicate an order", "summary": "Keep customers informed through fulfilment.", "content": "Confirm the ordered quantity and agreed delivery or pickup method. Check produce quality, pack it appropriately and communicate any genuine delay or shortage early. Update order stages accurately and keep proof of handover where the workflow requires it.", "translations": {"ta": {"title": "ஆர்டரை தயாரித்து தகவல் தெரிவிக்கவும்", "summary": "ஆர்டர் நிறைவேறும் வரை வாடிக்கையாளருடன் தொடர்பில் இருங்கள்.", "content": "ஆர்டர் அளவு மற்றும் ஒப்புக்கொண்ட விநியோகம் அல்லது pickup முறையை உறுதிப்படுத்துங்கள். தரத்தைச் சரிபார்த்து பொருத்தமாகப் பொதியுங்கள். தாமதம் அல்லது பற்றாக்குறை இருந்தால் முன்கூட்டியே தெரிவிக்கவும். ஆர்டர் நிலையை சரியாக புதுப்பிக்கவும்."}, "hi": {"title": "ऑर्डर तैयार करें और जानकारी दें", "summary": "ऑर्डर पूरा होने तक ग्राहक को सूचित रखें।", "content": "ऑर्डर मात्रा और तय डिलीवरी या पिकअप विधि की पुष्टि करें। गुणवत्ता जांचें और उचित पैकिंग करें। देरी या कमी होने पर समय से बताएं और ऑर्डर स्थिति सही अपडेट करें।"}}, "actionTasks": ["Confirm order quantity and fulfilment method", "Check and pack produce", "Update the order status and communicate changes"]},
        ],
    },
]


async def _seed_courses():
    courses = MongoDB.get_collection("education_courses")
    now = datetime.utcnow()
    for item in SEED_COURSES:
        existing = await courses.find_one({"slug": item["slug"]})
        if existing:
            continue
        course_doc = {k: v for k, v in item.items() if k != "lessons"}
        course_doc.update({"published": True, "createdAt": now, "updatedAt": now, "createdBy": "system"})
        result = await courses.insert_one(course_doc)
        lesson_docs = []
        for index, lesson in enumerate(item["lessons"], 1):
            row = dict(lesson)
            row.update({"courseId": result.inserted_id, "order": index, "estimatedMinutes": 10, "published": True, "createdAt": now, "updatedAt": now, "createdBy": "system"})
            lesson_docs.append(row)
        if lesson_docs:
            await MongoDB.get_collection("education_lessons").insert_many(lesson_docs)


def _localized(doc: dict, language: str) -> dict:
    row = _public(doc)
    translation = (doc.get("translations") or {}).get(language) or {}
    for key in ("title", "description", "summary", "content"):
        if translation.get(key):
            row[key] = translation[key]
    row["language"] = language
    return row


async def _require_farmer(user: dict):
    if user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Farmer access is required")


@router.get("/catalog")
async def get_catalog(language: str = Query("en", pattern="^(en|ta|hi)$"), current_user: dict = Depends(get_current_user)):
    await _require_farmer(current_user)
    await _seed_courses()
    courses = await MongoDB.get_collection("education_courses").find({"published": True}).sort("createdAt", -1).to_list(200)
    result = []
    lessons = MongoDB.get_collection("education_lessons")
    for course in courses:
        course_id = course["_id"]
        rows = await lessons.find({"courseId": course_id, "published": True}).sort("order", 1).to_list(500)
        item = _localized(course, language)
        item["lessons"] = [_localized(x, language) for x in rows]
        item["lessonCount"] = len(rows)
        result.append(item)
    return {"success": True, "data": {"courses": result, "language": language, "supportedLanguages": ["en", "ta", "hi"]}}


@router.get("/me/dashboard")
async def learning_dashboard(current_user: dict = Depends(get_current_user)):
    await _require_farmer(current_user)
    uid = _user_id(current_user)
    progress = await MongoDB.get_collection("education_progress").find({"farmerId": uid}).to_list(2000)
    saved = await MongoDB.get_collection("education_saved").find({"farmerId": uid}).to_list(1000)
    plans = await MongoDB.get_collection("education_action_plans").find({"farmerId": uid}).sort("createdAt", -1).to_list(100)
    completed = [p for p in progress if p.get("status") == "completed"]
    in_progress = [p for p in progress if p.get("status") == "in_progress"]
    return {"success": True, "data": {"completedLessonIds": [p.get("lessonId") for p in completed], "inProgress": [_public(p) for p in in_progress], "savedResourceIds": [p.get("resourceId") for p in saved], "actionPlans": [_public(p) for p in plans], "completedCount": len(completed), "savedCount": len(saved)}}


@router.post("/me/progress")
async def save_progress(body: ProgressBody, current_user: dict = Depends(get_current_user)):
    await _require_farmer(current_user)
    uid = _user_id(current_user)
    course_id = ObjectId(body.courseId) if ObjectId.is_valid(body.courseId) else None
    lesson_id = ObjectId(body.lessonId) if ObjectId.is_valid(body.lessonId) else None
    if not course_id or not lesson_id:
        raise HTTPException(status_code=400, detail="Invalid course or lesson id")
    lesson = await MongoDB.get_collection("education_lessons").find_one({"_id": lesson_id, "courseId": course_id, "published": True})
    if not lesson:
        raise HTTPException(status_code=404, detail="Published lesson not found")
    now = datetime.utcnow()
    await MongoDB.get_collection("education_progress").update_one(
        {"farmerId": uid, "lessonId": body.lessonId},
        {"$set": {"courseId": body.courseId, "status": body.status, "language": body.language, "secondsViewed": body.secondsViewed, "updatedAt": now}, "$setOnInsert": {"farmerId": uid, "lessonId": body.lessonId, "createdAt": now}},
        upsert=True,
    )
    return {"success": True, "data": {"lessonId": body.lessonId, "status": body.status, "updatedAt": now.isoformat()}}


@router.post("/me/saved")
async def save_resource(body: SavedBody, current_user: dict = Depends(get_current_user)):
    await _require_farmer(current_user)
    uid = _user_id(current_user)
    collection = MongoDB.get_collection("education_saved")
    query = {"farmerId": uid, "resourceId": body.resourceId}
    if body.saved:
        await collection.update_one(query, {"$set": {"updatedAt": datetime.utcnow()}, "$setOnInsert": {"createdAt": datetime.utcnow()}}, upsert=True)
    else:
        await collection.delete_one(query)
    return {"success": True, "data": {"resourceId": body.resourceId, "saved": body.saved}}


@router.post("/me/action-plans")
async def create_action_plan(body: ActionPlanBody, current_user: dict = Depends(get_current_user)):
    await _require_farmer(current_user)
    uid = _user_id(current_user)
    course_id = ObjectId(body.courseId) if ObjectId.is_valid(body.courseId) else None
    lesson_id = ObjectId(body.lessonId) if ObjectId.is_valid(body.lessonId) else None
    if not course_id or not lesson_id:
        raise HTTPException(status_code=400, detail="Invalid course or lesson")
    lesson = await MongoDB.get_collection("education_lessons").find_one({"_id": lesson_id, "courseId": course_id, "published": True})
    if not lesson:
        raise HTTPException(status_code=404, detail="Published lesson not found")
    tasks = [{"id": str(uuid4()), "title": str(t.get("title") or t)[:240], "completed": False} for t in body.tasks]
    doc = {"farmerId": uid, "courseId": body.courseId, "lessonId": body.lessonId, "title": body.title, "tasks": tasks, "createdAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}
    result = await MongoDB.get_collection("education_action_plans").insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "data": _public(doc)}


@router.patch("/me/action-plans/{plan_id}/tasks/{task_id}")
async def update_action_task(plan_id: str, task_id: str, body: TaskUpdateBody, current_user: dict = Depends(get_current_user)):
    await _require_farmer(current_user)
    if not ObjectId.is_valid(plan_id):
        raise HTTPException(status_code=400, detail="Invalid action plan")
    result = await MongoDB.get_collection("education_action_plans").update_one(
        {"_id": ObjectId(plan_id), "farmerId": _user_id(current_user), "tasks.id": task_id},
        {"$set": {"tasks.$.completed": body.completed, "updatedAt": datetime.utcnow()}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Action plan task not found")
    plan = await MongoDB.get_collection("education_action_plans").find_one({"_id": ObjectId(plan_id), "farmerId": _user_id(current_user)})
    return {"success": True, "data": _public(plan)}


@router.get("/me/recommendations")
async def learning_recommendations(current_user: dict = Depends(get_current_user)):
    await _require_farmer(current_user)
    month = datetime.utcnow().month
    seasonal = {
        1: ("Rabi crop care", "Review irrigation, crop monitoring and harvest planning for current field conditions."),
        2: ("Harvest and post-harvest handling", "Review safe harvesting, grading and storage practices."),
        3: ("Summer water management", "Review water-efficient irrigation and soil moisture monitoring."),
        4: ("Heat and water stress preparation", "Review irrigation maintenance, mulching and heat-stress monitoring."),
        5: ("Pre-monsoon field preparation", "Review drainage, soil preparation and local seasonal advisories."),
        6: ("Monsoon crop protection", "Review drainage, crop scouting and verified local pest advisories."),
        7: ("Monsoon field monitoring", "Review crop scouting, waterlogging prevention and safe pest monitoring."),
        8: ("Crop health monitoring", "Review symptom recording and local extension advice."),
        9: ("Post-monsoon crop planning", "Review soil testing, crop planning and irrigation readiness."),
        10: ("Rabi season preparation", "Review seed selection information and locally recommended sowing windows."),
        11: ("Irrigation and crop care", "Review soil moisture monitoring and crop-stage-based care."),
        12: ("Harvest and storage planning", "Review harvest timing, grading and post-harvest loss prevention."),
    }
    title, description = seasonal[month]
    return {"success": True, "data": {"seasonal": {"title": title, "description": description, "month": month, "basis": "Calendar-month learning suggestion; verify crop and district-specific practices with local agricultural experts."}, "recommendedCategories": ["Crop Management", "Irrigation", "Pest Management"]}}


@router.post("/assistant")
async def learning_assistant(body: AssistantBody, current_user: dict = Depends(get_current_user)):
    await _require_farmer(current_user)
    await _seed_courses()
    query = body.question.lower()
    words = [w for w in query.replace("?", " ").replace(",", " ").split() if len(w) > 2]
    lessons = await MongoDB.get_collection("education_lessons").find({"published": True}).to_list(1000)
    ranked = []
    for lesson in lessons:
        text = " ".join([lesson.get("title", ""), lesson.get("summary", ""), lesson.get("content", "")]).lower()
        score = sum(1 for word in words if word in text)
        if score:
            ranked.append((score, lesson))
    ranked.sort(key=lambda x: x[0], reverse=True)
    language = body.language
    if not ranked:
        fallback = {
            "en": "I could not find a matching lesson in the verified Education Center library. Please share the crop and symptoms or ask your local agricultural extension officer before taking crop-protection action.",
            "ta": "சரிபார்க்கப்பட்ட கல்வி மையப் பாடங்களில் பொருத்தமான தகவல் கிடைக்கவில்லை. பயிர் மற்றும் அறிகுறிகளை பகிரவும் அல்லது நடவடிக்கை எடுப்பதற்கு முன் உள்ளூர் வேளாண் அலுவலரை அணுகவும்.",
            "hi": "सत्यापित शिक्षा सामग्री में संबंधित पाठ नहीं मिला। फसल और लक्षण बताएं या कार्रवाई से पहले स्थानीय कृषि अधिकारी से सलाह लें।",
        }
        return {"success": True, "data": {"reply": fallback[language], "sources": [], "mode": "verified-content-retrieval"}}
    best = ranked[:3]
    answers = []
    sources = []
    for _, lesson in best:
        localized = (lesson.get("translations") or {}).get(language) or {}
        answers.append(localized.get("content") or lesson.get("content", ""))
        sources.append({"lessonId": str(lesson["_id"]), "title": localized.get("title") or lesson.get("title"), "courseId": str(lesson.get("courseId"))})
    intro = {"en": "Here is relevant guidance from the published AgriConnect learning library:", "ta": "AgriConnect கல்வி நூலகத்தில் உள்ள தொடர்புடைய வழிகாட்டுதல்:", "hi": "AgriConnect की प्रकाशित शिक्षण सामग्री से संबंधित मार्गदर्शन:"}[language]
    return {"success": True, "data": {"reply": intro + "\n\n" + "\n\n".join(answers), "sources": sources, "mode": "verified-content-retrieval", "disclaimer": "General learning information only. Confirm crop-specific treatment and input decisions with a qualified local agricultural expert."}}


@router.get("/admin/analytics")
async def education_admin_analytics(current_user: dict = Depends(require_role("admin"))):
    courses = MongoDB.get_collection("education_courses")
    lessons = MongoDB.get_collection("education_lessons")
    progress = MongoDB.get_collection("education_progress")
    farmers = MongoDB.get_collection("users")
    total_courses = await courses.count_documents({})
    published_courses = await courses.count_documents({"published": True})
    total_lessons = await lessons.count_documents({})
    total_farmers = await farmers.count_documents({"role": "farmer"})
    completions = await progress.count_documents({"status": "completed"})
    active_learners = len(await progress.distinct("farmerId"))
    return {"success": True, "data": {"totalCourses": total_courses, "publishedCourses": published_courses, "totalLessons": total_lessons, "totalFarmers": total_farmers, "lessonCompletions": completions, "activeLearners": active_learners}}


@router.get("/admin/courses")
async def admin_list_courses(current_user: dict = Depends(require_role("admin"))):
    await _seed_courses()
    rows = await MongoDB.get_collection("education_courses").find({}).sort("updatedAt", -1).to_list(500)
    result = []
    for row in rows:
        lessons = await MongoDB.get_collection("education_lessons").count_documents({"courseId": row["_id"]})
        item = _public(row)
        item["lessonCount"] = lessons
        result.append(item)
    return {"success": True, "data": {"courses": result}}


@router.post("/admin/courses")
async def admin_create_course(body: CourseBody, current_user: dict = Depends(require_role("admin"))):
    now = datetime.utcnow()
    doc = body.model_dump()
    doc.update({"slug": uuid4().hex, "createdAt": now, "updatedAt": now, "createdBy": _user_id(current_user)})
    result = await MongoDB.get_collection("education_courses").insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "data": _public(doc)}


@router.put("/admin/courses/{course_id}")
async def admin_update_course(course_id: str, body: CourseBody, current_user: dict = Depends(require_role("admin"))):
    if not ObjectId.is_valid(course_id):
        raise HTTPException(status_code=400, detail="Invalid course id")
    doc = body.model_dump()
    doc["updatedAt"] = datetime.utcnow()
    result = await MongoDB.get_collection("education_courses").update_one({"_id": ObjectId(course_id)}, {"$set": doc})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Course not found")
    row = await MongoDB.get_collection("education_courses").find_one({"_id": ObjectId(course_id)})
    return {"success": True, "data": _public(row)}


@router.post("/admin/courses/{course_id}/lessons")
async def admin_create_lesson(course_id: str, body: LessonBody, current_user: dict = Depends(require_role("admin"))):
    if not ObjectId.is_valid(course_id):
        raise HTTPException(status_code=400, detail="Invalid course id")
    if not await MongoDB.get_collection("education_courses").find_one({"_id": ObjectId(course_id)}):
        raise HTTPException(status_code=404, detail="Course not found")
    now = datetime.utcnow()
    doc = body.model_dump()
    doc.update({"courseId": ObjectId(course_id), "createdAt": now, "updatedAt": now, "createdBy": _user_id(current_user)})
    result = await MongoDB.get_collection("education_lessons").insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "data": _public(doc)}


@router.put("/admin/lessons/{lesson_id}")
async def admin_update_lesson(lesson_id: str, body: LessonBody, current_user: dict = Depends(require_role("admin"))):
    if not ObjectId.is_valid(lesson_id):
        raise HTTPException(status_code=400, detail="Invalid lesson id")
    doc = body.model_dump()
    doc["updatedAt"] = datetime.utcnow()
    result = await MongoDB.get_collection("education_lessons").update_one({"_id": ObjectId(lesson_id)}, {"$set": doc})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Lesson not found")
    row = await MongoDB.get_collection("education_lessons").find_one({"_id": ObjectId(lesson_id)})
    return {"success": True, "data": _public(row)}


@router.delete("/admin/lessons/{lesson_id}")
async def admin_delete_lesson(lesson_id: str, current_user: dict = Depends(require_role("admin"))):
    if not ObjectId.is_valid(lesson_id):
        raise HTTPException(status_code=400, detail="Invalid lesson id")
    result = await MongoDB.get_collection("education_lessons").update_one({"_id": ObjectId(lesson_id)}, {"$set": {"published": False, "updatedAt": datetime.utcnow()}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return {"success": True, "message": "Lesson unpublished"}


@router.delete("/admin/courses/{course_id}")
async def admin_archive_course(course_id: str, current_user: dict = Depends(require_role("admin"))):
    if not ObjectId.is_valid(course_id):
        raise HTTPException(status_code=400, detail="Invalid course id")
    result = await MongoDB.get_collection("education_courses").update_one({"_id": ObjectId(course_id)}, {"$set": {"published": False, "updatedAt": datetime.utcnow()}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Course not found")
    await MongoDB.get_collection("education_lessons").update_many({"courseId": ObjectId(course_id)}, {"$set": {"published": False, "updatedAt": datetime.utcnow()}})
    return {"success": True, "message": "Course archived"}
