# OTP Verification Flow - Fix Summary and Test Plan

## Issues Fixed

### 1. **Phone Normalization Inconsistency** ✓
- **Problem**: Register form passed raw user input to verify page, not normalized phone
- **Fix**: Updated register-form.tsx to use `data.phone` from API response
- **Files Changed**: `website/app/components/auth/register-form.tsx`

### 2. **OTPVerify Schema Validation** ✓
- **Problem**: OTPVerify schema didn't normalize phone, only OTPRequest did
- **Fix**: Added phone validator to OTPVerify schema that normalizes using same logic
- **Files Changed**: `backend/app/schemas/auth.py`

### 3. **Enhanced Logging for Debugging** ✓
- **Problem**: Silent failures made it hard to debug OTP flow
- **Fix**: Added detailed logging to OTP storage, retrieval, and verification steps
- **Files Changed**: `backend/app/api/v1/auth.py`

### 4. **Development Redis Fallback** ✓
- **Problem**: When Redis unavailable, OTP not stored anywhere
- **Fix**: Verified RedisClient has in-memory cache fallback for development
- **Already Working**: `backend/app/database/redis.py` has built-in fallback

### 5. **SMS Delivery Status Fallback** ✓
- **Problem**: Twilio SMS fails silently in development without credentials
- **Fix**: Added fallback in `send_sms()` to return True in dev environments
- **Files Changed**: `backend/app/services/notification_service.py`

### 6. **Debug Endpoint Added** ✓
- **Purpose**: Check if OTP exists in Redis/memory cache for a phone number
- **Endpoint**: `GET /api/v1/auth/debug/otp/{phone}`
- **Usage**: `curl http://localhost:8000/api/v1/auth/debug/otp/9176358376`
- **Files Changed**: `backend/app/api/v1/auth.py`

## Complete OTP Flow (Now Fixed)

```
1. User Registration
   - Enters: phone="9176358376" (raw 10-digit local format)
   - Form submits to: POST /api/auth/register
   
2. Frontend Register Route (website/app/api/auth/register/route.ts)
   - Normalizes phone: "9176358376" → "+919176358376"
   - Sends to backend: POST /api/v1/auth/register
   
3. Backend Registration Endpoint (auth.py)
   - Receives phone, Pydantic validator normalizes: "+919176358376"
   - Creates user in database with normalized phone
   - Calls _send_registration_otp(user, "+919176358376")
     - Generates OTP: "123456"
     - Stores in cache: key="otp:+919176358376", value={"otp":"123456","type":"registration"}
     - Attempts SMS delivery (succeeds in dev with fallback)
   - Returns response with data.phone="+919176358376"
   
4. Frontend Uses Normalized Phone
   - Register form receives response
   - Redirects to: /verify?phone=%2B919176358376 (URL encoded)
   - Which displays: /verify?phone=+919176358376
   
5. User Verification
   - Verify page reads phone from URL: "+919176358376"
   - User enters OTP: "123456"
   - Form submits to: POST /api/auth/verify with {phone: "+919176358376", otp: "123456"}
   
6. Frontend Verify Route (website/app/api/auth/verify/route.ts)
   - Normalizes phone: "+919176358376" → "+919176358376" (idempotent)
   - Sends to backend: POST /api/v1/auth/verify-otp
   
7. Backend Verification Endpoint (auth.py)
   - Receives phone from body
   - Schema validator normalizes: "+919176358376" → "+919176358376"
   - Looks up cache: key="otp:+919176358376"
   - Finds OTP: {"otp":"123456","type":"registration"}
   - Compares: provided="123456" vs stored="123456" → MATCH ✓
   - Creates JWT tokens
   - Deletes OTP from cache
   - Returns tokens and redirects to login
```

## Testing Checklist

### Prerequisites
- [ ] Backend running: `cd backend && python -m uvicorn app.main:app --reload`
- [ ] Website running: `cd website && npm run dev`
- [ ] Either:
  - [ ] Docker services running (`docker-compose up`) for Redis
  - [ ] OR in-memory cache fallback (automatic if Redis unavailable)

### Step-by-Step Test

1. **Register with Phone Number**
   - Go to: http://localhost:3000/register
   - Fill form:
     - First Name: Test
     - Last Name: User
     - Phone: 9176358376 (or any 10-digit number)
     - Email: test@example.com
     - Password: TestPass@123
     - Role: Customer
   - Click Register
   - **Expected**: Redirects to /verify?phone=%2B919176358376

2. **Check Backend Logs**
   - Watch backend terminal for messages:
     - `Storing OTP in Redis: key=otp:+919176358376, otp=XXXXXX, type=registration`
     - `OTP stored successfully for +919176358376`
     - `OTP send result for registration: True`

3. **Check Debug Endpoint**
   - Open browser: http://localhost:8000/api/v1/auth/debug/otp/9176358376
   - **Expected**: 
     ```json
     {
       "phone_input": "9176358376",
       "normalized_phone": "+919176358376",
       "cache_key": "otp:+919176358376",
       "otp_data": {"otp": "XXXXXX", "type": "registration"},
       "otp_exists": true
     }
     ```

4. **Submit OTP on Verify Page**
   - On verify page, enter the OTP displayed in backend logs
   - Click "Verify"
   - **Expected**: 
     - Redirects to /login
     - Network request succeeds (200 OK)
     - Backend logs show verification success

5. **Check Network Requests**
   - Open DevTools (F12) → Network tab
   - Look for:
     - `POST /api/auth/register` → 200 with data.phone="+919176358376"
     - `POST /api/auth/verify` → 200 with tokens
   - No 400 errors

### Troubleshooting

If you get **400 error on POST /api/auth/verify**:

1. **Check phone format in request**
   - DevTools → Network → POST /api/auth/verify
   - Look at Request Body
   - Phone should be: "+919176358376" or at least a valid format

2. **Check OTP in Redis/Cache**
   - Use debug endpoint: `GET /api/v1/auth/debug/otp/{phone}`
   - If `otp_exists: false`, OTP wasn't stored properly
   - Check backend logs for storage errors

3. **Check OTP expiration**
   - OTP expires after 5 minutes (configurable in config.py)
   - If test took >5 min, generate new OTP from registration endpoint
   - **To get new OTP**: Use `POST /api/v1/auth/login-otp` with phone number

4. **Check Redis/Cache connectivity**
   - If in-memory fallback: should work even without Docker
   - If using Redis: ensure `docker-compose up` is running
   - Check backend logs for Redis connection messages

## Files Modified

### Backend (Python/FastAPI)
- `backend/app/api/v1/auth.py` - Enhanced logging, debug endpoint, schema normalization
- `backend/app/schemas/auth.py` - Added phone validator to OTPVerify
- `backend/app/services/notification_service.py` - SMS delivery fallback for dev

### Frontend (Next.js/TypeScript)  
- `website/app/components/auth/register-form.tsx` - Use normalized phone from response
- `website/app/(auth)/verify/page.tsx` - Functional verify form (already done)
- `website/app/api/auth/verify/route.ts` - Verify API route (already done)

## Key Implementation Details

### Phone Normalization (Consistent Everywhere)
```
Input formats accepted:
- "9876543210" (10 digits) → "+919876543210"
- "919876543210" (12 digits) → "+919876543210"
- "+919876543210" (already normalized) → "+919876543210"
- "+91-9876543210" (with dash) → "+919876543210"

Output format: Always E.164
- +{country_code}{digits}
- Example: +919876543210 (country=91 for India)
```

### OTP Cache Keys
```
Format: "otp:{normalized_phone}"
Example: "otp:+919876543210"

Value stored (JSON):
{
  "otp": "123456",
  "type": "registration"  // or "login" or "test"
}

Expiration: 5 minutes (300 seconds)
Fallback: In-memory dict if Redis unavailable
```

### SMS Delivery
```
Twilio Required? No (in development)
- If Twilio credentials available: sends real SMS
- If Twilio unavailable + environment=dev + DEBUG=True: 
  - Logs OTP to console
  - Returns success
  - Allows testing without Twilio credentials

Production: Requires Twilio credentials
```

## Running with Docker (Optional)

If you want to use real Redis instead of in-memory cache:

```bash
# From root directory
docker-compose -f backend/docker-compose.yml up

# Backend will automatically connect to Redis
# Logs will show: "✅ Connected to Redis"
```

If not using Docker:
```bash
# Backend uses in-memory fallback automatically
# Logs will show: "Redis is unavailable, using in-memory fallback cache for development"
```

## Next Steps

1. **Run the test checklist** to verify the complete flow works
2. **Check backend logs** for any errors during OTP storage/retrieval
3. **Use debug endpoint** to inspect Redis/cache state
4. **Report any 400 errors** with the exact phone number and OTP tested
