import re
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime

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


class DataAssistantService:

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

        order_number = _extract_order_number(text)
        if order_number:
            return await DataAssistantService._answer_order_by_number(order_number, lang)

        handlers = [
            ("my_orders", DataAssistantService._detect_my_orders, DataAssistantService._answer_my_orders),
            ("my_wallet", DataAssistantService._detect_my_wallet, DataAssistantService._answer_my_wallet),
            ("my_inventory", DataAssistantService._detect_my_inventory, DataAssistantService._answer_my_inventory),
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

        return {"reply": HELP_RESPONSES[lang]["default"], "language": lang, "intent": "default", "data": None}

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