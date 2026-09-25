# Quick Test - AgriConnect

## Start services

### Backend
From the repository root:

```bash
cd backend
poetry run uvicorn app.main:app --reload
```

Backend API documentation:

- Swagger UI: `http://localhost:8000/api/docs`
- ReDoc: `http://localhost:8000/api/redoc`

### Website

```bash
cd website
npm install
npm run dev
```

Open `http://localhost:3000`.

### Mobile

```bash
cd mobile
flutter pub get
flutter test
flutter analyze
flutter run
```

The mobile app currently supports these dashboard roles:

- Customer
- Farmer
- Delivery Partner

## OTP verification flow

1. Open the registration page.
2. Register with a valid phone number, email, and password.
3. The backend creates a short-lived OTP and sends it through the configured delivery providers.
4. Enter the OTP on the verification screen.
5. A successful verification creates the authenticated session and routes the user to the appropriate supported dashboard.

In development mode, the backend may log the generated OTP to the server log for local testing. Production environments must keep `DEBUG=false`.

## Authentication checks

- OTP attempts are limited.
- OTP values are stored as hashes rather than raw values.
- Verified accounts cannot be registered again.
- Privileged accounts can require TOTP-based MFA.
- Access and refresh tokens use server-side revocation/session tracking.

## Backend test suite

From `backend`:

```bash
poetry run pytest -v
```

The repository's latest verified backend run passed **198 tests**.

## Website checks

From `website`:

```bash
npm run lint
npm run build
npm test
```

## CI checks

The repository CI validates:

- Website lint and production build
- Backend compilation and pytest
- Flutter formatting, analysis, and tests

Use repository CI results as the source of truth for the final integration status.
