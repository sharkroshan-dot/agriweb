# AgriConnect AI - Farm-to-Home Marketplace

A full-stack agriculture marketplace platform connecting farmers directly with customers, featuring AI-powered insights, real-time delivery tracking, and role-based dashboards.

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm/pnpm
- **Flutter** 3.16+ and Dart 3.2+
- **Python** 3.11+ and pip
- **MongoDB** 6.0+
- **Redis** 7.0+
- **Docker** & Docker Compose (recommended)

---

## 🐳 Option 1: Docker Compose (Recommended)

```bash
# Clone and navigate
cd agri

# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f backend
docker-compose logs -f website
docker-compose logs -f mobile
```

**Services will be available at:**
- **Website**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **MongoDB**: localhost:27017
- **Redis**: localhost:6379
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)

---

## 💻 Option 2: Local Development

### Backend (FastAPI)

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
cp .env.example .env
# Edit .env with your MongoDB, Redis, and API keys

# Run development server
python run.py
# Or with auto-reload: uvicorn app.main:app --reload --port 8000
```

### Website (Next.js 15)

```bash
cd website

# Install dependencies
npm install
# Or: pnpm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with backend URL and auth secrets

# Run development server
npm run dev
# Opens at http://localhost:3000
```

### Mobile App (Flutter)

```bash
cd mobile

# Get dependencies
flutter pub get

# Run on connected device/emulator
flutter run

# Build APK
flutter build apk --release

# Build iOS (macOS only)
flutter build ios --release
```

---

## 🔧 Environment Variables

### Backend (`backend/.env`)

```env
# Database
MONGODB_URL=mongodb://localhost:27017/agriconnect
REDIS_URL=redis://localhost:6379/0

# Security
SECRET_KEY=your-super-secret-key-change-in-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# AI/ML
ENABLE_AI_FEATURES=true
MODEL_PATH=./models

# External APIs
RAZORPAY_KEY_ID=your-razorpay-key
RAZORPAY_KEY_SECRET=your-razorpay-secret
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
SENDGRID_API_KEY=your-sendgrid-key

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
```

### Website (`website/.env.local`)

```env
# API
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_WS_URL=ws://localhost:8000

# Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret

# OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

---

## 🏗️ Project Structure

```
agri/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── api/            # API routes
│   │   ├── ai/             # AI/ML models
│   │   ├── models/         # Database models
│   │   ├── repositories/   # Data access layer
│   │   ├── schemas/        # Pydantic schemas
│   │   ├── services/       # Business logic
│   │   └── tasks/          # Celery background jobs
│   ├── tests/              # Pytest tests
│   └── scripts/            # Utility scripts
│
├── website/                 # Next.js 15 frontend
│   ├── app/                # App Router pages
│   │   ├── (auth)/         # Auth pages
│   │   ├── (customer)/     # Customer dashboard
│   │   ├── (farmer)/       # Farmer dashboard
│   │   ├── (delivery)/     # Delivery partner dashboard
│   │   ├── (admin)/        # Admin dashboard
│   │   ├── api/            # API routes
│   │   └── components/     # Shared components
│   ├── lib/                # Utilities, hooks, stores
│   └── public/             # Static assets
│
├── mobile/                  # Flutter mobile app
│   ├── lib/
│   │   ├── core/           # Core services, theme, router
│   │   ├── features/       # Feature modules
│   │   │   ├── customer/   # Customer screens
│   │   │   ├── farmer/     # Farmer screens
│   │   │   ├── delivery/   # Delivery screens
│   │   │   └── shared/     # Shared widgets
│   │   └── main.dart       # Entry point
│   └── assets/             # Images, fonts, translations
│
├── docker/                  # Docker configurations
│   ├── backend.Dockerfile
│   ├── website.Dockerfile
│   └── docker-compose.yml
│
└── docs/                    # Documentation
    ├── AI_ARCHITECTURE.md
    └── architecture-diagram.svg
```

---

## 🎯 Key Features

### Customer Features
- 🛒 Browse & search products with filters
- 📦 Cart & checkout with delivery/pickup
- 💳 Multiple payment methods (UPI, Card, COD)
- 📍 Real-time order tracking
- ⭐ Reviews & ratings
- 🔔 Smart notifications

### Farmer Features
- 🌾 Product management (CRUD)
- 📊 AI-powered demand forecasting
- 💰 Smart pricing recommendations
- 🚚 Delivery route optimization
- 📈 Analytics & earnings dashboard
- 🤖 AI Farm Advisor

### Delivery Partner Features
- 🗺️ Smart route planning
- 📋 Delivery job management
- 💵 Earnings & settlements
- ⭐ Ratings & performance

### Admin Features
- 👥 User management
- 📦 Product moderation
- 📊 Platform analytics
- 🎫 Coupon management
- 🔒 Security & audit logs

### AI Features
- 🔮 **Demand Prediction** - Forecast product demand
- 💰 **Smart Pricing** - AI price recommendations
- 🚚 **Route Optimization** - Delivery route planning
- 🎯 **Recommendations** - Personalized suggestions
- ⚠️ **Fraud Detection** - Risk scoring
- 📦 **Quality Inspection** - Computer vision grading
- 🎤 **Voice Assistant** - Hands-free AI interaction

---

## 🧪 Testing

### Backend Tests
```bash
cd backend
pytest                    # All tests
pytest -v                 # Verbose
pytest tests/test_ai.py   # Specific test file
pytest --cov=app          # With coverage
```

### Website Tests
```bash
cd website
npm run test              # Jest unit tests
npm run test:watch        # Watch mode
npm run cypress           # E2E tests
```

### Mobile Tests
```bash
cd mobile
flutter test              # Unit/widget tests
flutter test integration_test/  # Integration tests
```

---

## 📦 Deployment

### Production Docker Compose
```bash
cd docker
docker-compose -f docker-compose.prod.yml up -d
```

### Environment-Specific Configs
- `docker-compose.yml` - Development
- `docker-compose.prod.yml` - Production
- `docker-compose.staging.yml` - Staging

### Health Checks
```bash
# Backend
curl http://localhost:8000/health

# Website
curl http://localhost:3000/api/health

# Database
docker exec mongodb mongosh --eval "db.adminCommand('ping')"
```

---

## 🤖 AI Model Training

```bash
cd backend

# Train quality vision model
python scripts/train_quality_vision.py

# Setup all AI models
python scripts/setup_ai_models.py

# Export quality dataset
python scripts/export_quality_dataset.py
```

---

## 📚 API Documentation

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **OpenAPI JSON**: http://localhost:8000/openapi.json

### Key Endpoints

| Feature | Endpoint |
|---------|----------|
| Products | `GET /api/v1/products/search` |
| Orders | `POST /api/v1/orders` |
| AI Advisor | `GET /api/v1/farmers/me/advisor` |
| Demand Heatmap | `POST /api/v1/ai/demand-heatmap` |
| Quality Check | `POST /api/v1/ai/quality-check` |
| Voice Assistant | `POST /api/v1/ai/voice` |

---

## 🎨 UI/UX Highlights

- **Modern Design** - Tailwind CSS + Radix UI components
- **Dark Mode** - System-aware theme switching
- **Responsive** - Mobile-first, works on all devices
- **Accessible** - WCAG 2.1 AA compliant
- **Animations** - Smooth transitions with Framer Motion
- **Skeletons** - Perceived performance loading states

---

## 📱 Mobile App Features

- **Cross-platform** - iOS & Android from single codebase
- **Offline Support** - Cached data with sync
- **Push Notifications** - Firebase Cloud Messaging
- **Biometric Auth** - Fingerprint/Face ID
- **Maps Integration** - Real-time tracking
- **Camera/Scanner** - QR codes, product photos

---

## 🔐 Security

- JWT authentication with refresh tokens
- Role-based access control (RBAC)
- Rate limiting & CORS protection
- Input validation & sanitization
- Secure password hashing (bcrypt)
- OTP-based 2FA for sensitive roles
- Audit logging for all critical actions

---

## 📊 Monitoring & Observability

- **Prometheus** - Metrics collection
- **Grafana** - Dashboards & alerting
- **Structured Logging** - JSON logs
- **Health Endpoints** - `/health` on all services
- **Distributed Tracing** - OpenTelemetry ready

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style
- **Backend**: Black, isort, flake8
- **Website**: ESLint, Prettier, TypeScript strict
- **Mobile**: flutter_lints, dart format

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🆘 Support

- **Documentation**: [docs/](docs/)
- **Issues**: GitHub Issues
- **Discord**: [Join our community](https://discord.gg/agriconnect)
- **Email**: support@agriconnect.ai

---

## 🙏 Acknowledgments

- Farmers who inspire this platform
- Open source community
- AI/ML researchers in agriculture

---

**Built with ❤️ for Indian Agriculture**

## Current enhancement branch

The production enhancement work is being developed on `feature/agriconnect-complete-enhancement` before merge to `main`. The branch adds CI quality gates, a role-aware AI Copilot widget, deterministic AI fallbacks, persisted forecasting models, and production implementation guidance.

### Run the website locally

```powershell
cd website
npm install
npm run dev
```

Open **http://localhost:3000**.

If the backend is running locally, create `website/.env.local` with:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-a-long-random-secret
```

### Run the backend locally

```powershell
cd backend
python -m venv venv
venv/Scripts/Activate.ps1
pip install -r requirements.txt
python run.py
```

Backend: **http://localhost:8000**  
Swagger: **http://localhost:8000/docs**

> AI features that require historical data or external providers should report unavailable or insufficient data instead of fabricating observations. Model outputs are recommendations; users remain responsible for operational decisions.


## Production-ready enhancement

The project now uses a shared production-oriented foundation across web, API, AI workers, and mobile.

### Local development
- Backend: Python **3.11** is the supported runtime. Do not use Python 3.14 for this backend environment.
- Full local stack: `docker compose up --build`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/api/docs`
- Website: `http://localhost:3000`
- Liveness: `/health/live`
- Readiness: `/health/ready`

### AI platform
- Price prediction and demand forecasting use the existing model implementations.
- Admin training requests create persistent training jobs and dispatch Celery workers.
- Training status is stored in MongoDB instead of returning synthetic progress.
- Model registry artifacts are retained under the AI model registry.
- AI router failures are no longer silently replaced by stubs in production.

### Production configuration
Set strong values for `JWT_SECRET`, explicit `BACKEND_CORS_ORIGINS`, `ALLOWED_HOSTS`, MongoDB credentials, and MongoDB TLS before setting `DEBUG=false` or `ENVIRONMENT=production`.

### UI consistency
The website uses shared UI primitives and global design tokens for controls, cards, selection states, spacing, focus states, and brand colors. Reuse `website/app/components/ui` rather than introducing page-specific button colors.

### CI
GitHub Actions validates website lint/build, backend compilation/tests, Flutter analysis/tests, dependency auditing, and basic committed-secret hygiene.
