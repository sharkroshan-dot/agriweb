# Quick Test - OTP Verification Fix

## 🚀 Start Services

### Terminal 1: Backend
```bash
cd e:\agri\backend
python -m uvicorn app.main:app --reload
```

### Terminal 2: Website  
```bash
cd e:\agri\website
npm run dev
```

## ✅ Test Flow

1. **Register**
   - Go to: http://localhost:3000/register
   - Phone: `9176358376` (or any 10-digit number)
   - Email: `test@example.com`
   - Password: `TestPass@123` (uppercase, lowercase, digit, special char)
   - Submit

2. **Check Backend Logs** (Terminal 1)
   - Look for: `Storing OTP in Redis: key=otp:+919176358376, otp=XXXXXX`
   - Copy the OTP code (6 digits)

3. **Debug Check** (Optional)
   - Open: http://localhost:8000/api/v1/auth/debug/otp/9176358376
   - Should show: `"otp_exists": true` and the OTP value

4. **Verify**
   - You should be on: http://localhost:3000/verify?phone=%2B919176358376
   - Paste the OTP code from step 2
   - Click "Verify"
   - **Expected**: Redirect to login page ✓

## 🔍 Common Issues

| Issue | Check |
|-------|-------|
| 400 error on verify | Debug endpoint shows `otp_exists: false` → OTP not stored |
| OTP not showing | Check backend logs for errors during storage |
| Phone shows as "9176358376" | Register form might not be updated |
| 5 min timeout | OTP expires after 5 minutes |

## 📋 What Was Fixed

1. ✅ Register form now uses normalized phone from API response
2. ✅ OTPVerify schema validates and normalizes phone  
3. ✅ Added debug endpoint to inspect OTP state
4. ✅ Enhanced logging for troubleshooting
5. ✅ Verified in-memory cache works without Redis

## 💡 Expected Behavior

- Register with "9176358376" → stores OTP with key "otp:+919176358376"
- Verify page receives "+919176358376" in URL
- Submit "+919176358376" + OTP to verify endpoint
- OTP found and verified → login successful
