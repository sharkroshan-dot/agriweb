# AgriConnect AI — Agri Intelligence Engine

> AgriConnect AI uses marketplace, location, transaction, inventory, and delivery data to continuously improve agricultural selling, purchasing, and logistics. AI is the intelligence layer behind the marketplace, delivery, finance, and farmer-management systems — not just a chatbot.

---

## 1. Overall Architecture

```text
                         AGRICONNECT AI
                              │
                    ┌─────────▼─────────┐
                    │   USER ACTIVITY   │
                    │                   │
                    │ Customers         │
                    │ Farmers           │
                    │ Delivery Partners │
                    │ Orders            │
                    │ Payments          │
                    │ Locations         │
                    └─────────┬─────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │  DATA PIPELINE  │
                     │                 │
                     │ MongoDB         │
                     │ Order History   │
                     │ GPS Data        │
                     │ Sales Data      │
                     │ Delivery Data   │
                     │ Payment Data    │
                     └────────┬────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │   AI ENGINE       │
                    │                   │
                    │ 1. Fraud          │
                    │ 2. Delivery Risk  │
                    │ 3. Demand         │
                    │ 4. Pricing        │
                    │ 5. Community      │
                    │ 6. Anomaly        │
                    └─────────┬─────────┘
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          CUSTOMER          FARMER          DELIVERY
             │                │                │
             ▼                ▼                ▼
       Recommendations   Suggestions       Smart Routes
       Offers            Forecast          Job Matching
       Alerts            Pricing           Risk Alerts
```

---

## 2. AI Features

### 2.1 Fraud Detection

Detects suspicious behavior around COD, payments, refunds, coupons, accounts, orders, ratings, and payouts.

**Example:** A customer places 4 COD orders and cancels each, then places a ₹8,000 COD order.

```
⚠️ Unusual COD behavior
Risk Score: 87/100
```

**Inputs:** customer history, COD cancellation rate, order value, refund frequency, account age, device/IP patterns, coupon usage, payment failures.

**Output — do not auto-ban. Risk buckets:**

```
0–30     🟢 Low
31–70    🟡 Medium
71–100   🔴 High
```

High-risk orders go to manual review / additional verification (e.g. OTP).

### 2.2 Delivery-Risk Prediction

Predicts how likely a delivery is to be late or fail before it starts.

**Inputs:** distance, traffic, time slot, partner history, number of deliveries, weather (if integrated), vehicle capacity, customer availability, previous delivery delays.

**Example:**

```
Order #AG1030
Delivery Risk: 82%
🔴 High Risk
→ Recommend: "Assign this order to another available partner."
```

### 2.3 Demand Prediction

Predicts what products will be purchased in coming days/weeks. One of the most valuable features for farmers.

**Inputs:** historical sales, season, day of week, location, price, promotions, weather, harvest availability, customer behavior.

**Example forecast:**

```
Tomorrow:
🍅 Tomato  Expected demand: 140 KG
🧅 Onion   Expected demand: 85 KG
🥔 Potato  Expected demand: 60 KG
```

**Farmer dashboard:**

```
🤖 AI Demand Forecast  —  Next 7 Days
🍅 Tomato  ████████████  High
🧅 Onion   ████████      Medium
🥔 Potato  ██████        Low
Recommendation: Increase tomato inventory by ~20–30%.
```

### 2.4 Smart Pricing

AI provides **price recommendations**, never blindly changes farmer prices.

**Example:**

```
Your Tomato Price:  ₹40/kg
Nearby farmers:     ₹42/kg average
Demand:             🔥 High
Available supply:   Low
AI Suggested Range: ₹42 – ₹45/kg
```

Farmer decides: `[ Keep ₹40 ]` / `[ Change to ₹43 ]`

**Inputs:** current price, nearby farmer prices, demand, inventory, historical sales, season, location, product quality.

### 2.5 Community Delivery Optimization

Groups orders in the same area into a single delivery batch.

**Example:** Customers A, B, C, D in the same area.

```
4 separate deliveries → COMMUNITY DELIVERY (1 batch)

Total: 14 KG
Delivery distance: 8.2 KM
Estimated individual distance: 18.5 KM
Potential saving: 10.3 KM
```

**Farmer dashboard:**

```
🤖 Smart Delivery Opportunity
4 customers are located within the same area.
Recommended: Batch these orders together.
[ Create Delivery Batch ]
```

### 2.6 Anomaly Detection

Different from fraud: asks "is this behavior unusual compared with normal behavior?", not "is it malicious?".

**Example:** A farmer normally sells ₹5,000–₹10,000/day but suddenly ₹1,50,000/day → flagged for review. Could be a legitimate large B2B order.

---

## 3. Fraud vs Anomaly Summary

| Feature                | Purpose                               |
| ---------------------- | ------------------------------------- |
| Fraud Detection        | Detect potentially malicious behavior |
| Anomaly Detection      | Detect unusual behavior               |
| Risk Prediction        | Predict future problems               |
| Demand Prediction      | Predict future demand                 |
| Smart Pricing          | Recommend prices                      |
| Community Optimization | Optimize group logistics              |

---

## 4. Learning Data

MongoDB generates: Users, Orders, Products, Inventory, Payments, Deliveries, GPS, Ratings, Cancellations, Refunds, Coupons, COD, Farmer sales, Partner performance.

**Example order history:**

```
Order 001  Tomato  5 KG  ₹200  Coimbatore  Delivered  45 min
Order 002  Tomato  10 KG ₹400  Coimbatore  Delivered  52 min
Order 003  Onion   5 KG  ₹250  Pollachi    Cancelled
```

This becomes training data.

---

## 5. Data Pipeline

```
MongoDB → Data Extraction → Data Cleaning → Feature Engineering → Training Dataset
→ ML Model → Model Registry → AI API → AgriConnect Application
```

Do not train directly from production MongoDB every time.

---

## 6. Recommended Technology

| Layer       | Choice                                            |
| ----------- | ------------------------------------------------- |
| Backend     | FastAPI                                           |
| Database    | MongoDB                                           |
| ML          | scikit-learn, XGBoost, LightGBM (preferred for structured data); PyTorch/TensorFlow only when needed |

For the initial system, XGBoost/LightGBM and scikit-learn are more practical than neural networks for structured marketplace data.

### Model Selection

| AI Feature         | Initial Model                          |
| ------------------ | -------------------------------------- |
| Fraud Detection    | XGBoost / Random Forest                |
| Delivery Risk      | XGBoost / LightGBM                     |
| Demand Prediction  | XGBoost / LightGBM / time-series model |
| Smart Pricing      | Regression + optimization              |
| Community Delivery | Clustering + route optimization        |
| Anomaly Detection  | Isolation Forest                       |

---

## 7. AI Service in the Backend

AI is separated from normal business services.

```text
FastAPI
├── User Service
├── Farmer Service
├── Marketplace Service
├── Order Service
├── Payment Service
├── Delivery Service
├── Finance Service
├── Notification Service
└── AI Service
      ├── Fraud Detection
      ├── Demand Prediction
      ├── Delivery Risk
      ├── Smart Pricing
      ├── Community Optimization
      └── Anomaly Detection
```

---

## 8. Example AI APIs

### Delivery Risk

```
POST /api/ai/delivery-risk
```

```json
{
  "order_id": "AG1025",
  "distance_km": 18.5,
  "delivery_window_minutes": 120,
  "partner_current_load": 6,
  "partner_on_time_rate": 0.94
}
```

```json
{
  "risk_score": 0.18,
  "risk_level": "LOW",
  "recommendation": "Proceed with current partner"
}
```

### Demand Prediction

```
GET /api/ai/demand/tomato?location=coimbatore
```

```json
{
  "product": "Tomato",
  "location": "Coimbatore",
  "forecast": { "next_7_days_kg": 840 },
  "trend": "increasing",
  "confidence": 0.87
}
```

### Smart Pricing

```
POST /api/ai/pricing/recommend
```

```json
{
  "product": "Tomato",
  "current_price": 40,
  "inventory": 120,
  "location": "Coimbatore"
}
```

```json
{
  "recommended_min": 42,
  "recommended_max": 45,
  "demand": "HIGH",
  "reason": ["High local demand", "Low nearby supply"]
}
```

### Delivery Matching

AI ranks eligible partners:

```
Arun    96%
Kumar   91%
Ravi    84%
Suresh  60%
```

Top partners receive the opportunity. **AI recommends/routes the job; business rules still decide who can claim it.**

### Order Map Insight

```
🤖 Smart Delivery Analysis
25 orders today
15 orders → Self Delivery recommended
7 orders → Partner Delivery recommended
3 orders → High delivery risk
Estimated total distance: 42 KM
Recommended route: 27.8 KM
Potential distance saving: 14.2 KM
[ Apply Recommendation ]
```

### Farmer AI Dashboard

```
┌──────────────────────────────────────┐
│ 🤖 AI FARM ASSISTANT                 │
├──────────────────────────────────────┤
│ 🍅 Tomato demand is HIGH             │
│ 🚚 4 deliveries can be grouped      │
│ 💰 Tomato price could be ₹42–45/kg  │
│ ⚠️ 2 deliveries have high risk      │
│ 📦 Onion inventory may last 3 days   │
│ [ View All Insights ]                │
└──────────────────────────────────────┘
```

### Customer Recommendation

Customer: "I need vegetables for a family of 5."

```
🥕 Carrot  1 KG
🍅 Tomato  2 KG
🥔 Potato  2 KG
🧅 Onion   1 KG
Estimated: ₹420–₹500
Nearby farmers: 3
[ Add Recommended Items ]
```

A recommendation system, separate from the six core AI features.

---

## 9. Guardrail: AI Does Not Decide Alone

Never design:

```text
AI → automatically ban customer
AI → automatically change farmer price
AI → automatically cancel order
```

Always:

```text
AI → Prediction / Recommendation → Business Rules → Human Confirmation (when necessary) → Action
```

**Example:**

```
AI: Fraud Risk = 92%
       ↓
System: Require additional verification
       ↓
Customer: Verify OTP
       ↓
Continue / Review
```

---

## 10. Build Order (Recommended Roadmap)

1. **Stage 1 — Collect data:** build the marketplace (customers, farmers, orders, products, payments, deliveries, GPS, ratings).
2. **Stage 2 — Start with 3 AI models:** Demand Prediction, Delivery Risk Prediction, Fraud/Anomaly Detection.
3. **Stage 3 — Smart Pricing.**
4. **Stage 4 — Community Delivery Optimization.**
5. **Stage 5 — Automated Anomaly Detection** (more useful once enough normal transaction history exists).

---

## 11. Key Idea

> Not "we added AI to an agriculture marketplace", but:
> **"AgriConnect AI uses marketplace, location, transaction, inventory, and delivery data to continuously improve agricultural selling, purchasing, and logistics."**