# OTP Verification - Data Flow Diagram

## Before (Broken ❌)
```
User Registration
    │
    ├─ Form Input: phone = "9176358376" (raw)
    │
    └─→ POST /api/auth/register
         │
         └─→ Frontend Route Normalizes: "+919176358376"
              │
              └─→ Backend Stores: OTP with key "otp:+919176358376"
                   │
                   └─→ API Response: data.phone = "+919176358376"
                        │
                        └─→ Register Form Redirects with: phone = "9176358376" ❌
                             (Uses raw input, not response!)
                             │
                             └─→ /verify?phone=9176358376
                                  │
                                  └─→ User Submits OTP: "123456"
                                       │
                                       └─→ POST /api/auth/verify
                                            │
                                            └─→ Backend Normalizes: "+919176358376"
                                                 │
                                                 └─→ Looks for: "otp:+919176358376"
                                                      │
                                                      └─→ FOUND, But...
                                                           └─→ Backend receives phone = "9176358376"
                                                                │
                                                                └─→ API Route tries lookup
                                                                     │
                                                                     ❌ ERROR: 400 - OTP not found

Original Issue:
- Stored with key: "otp:+919176358376"
- Looked up with key: "otp:9176358376"  
- MISMATCH → 400 Error
```

## After (Fixed ✓)
```
User Registration
    │
    ├─ Form Input: phone = "9176358376" (raw)
    │
    └─→ POST /api/auth/register
         │
         ├─→ Frontend Route Normalizes: "+919176358376"
         │
         └─→ Backend Stores: OTP with key "otp:+919176358376"
              │
              └─→ API Response: data.phone = "+919176358376"
                   │
                   └─→ Register Form Redirects with: phone = "+919176358376" ✓
                        (Uses data.phone from response!)
                        │
                        └─→ /verify?phone=%2B919176358376
                             │
                             └─→ Verify Page Gets Phone: "+919176358376"
                                  │
                                  └─→ User Submits OTP: "123456"
                                       │
                                       └─→ POST /api/auth/verify
                                            {phone: "+919176358376", otp: "123456"}
                                            │
                                            ├─→ Frontend API Route:
                                            │   └─→ Normalize: "+919176358376" (idempotent)
                                            │
                                            └─→ Backend Endpoint:
                                                 │
                                                 ├─→ Schema Validates: "+919176358376" ✓
                                                 │
                                                 └─→ Looks for: "otp:+919176358376"
                                                      │
                                                      ✓ FOUND! Both use same normalized key
                                                      │
                                                      └─→ OTP Verified
                                                           │
                                                           └─→ 200 OK - Login Success ✓
```

## Key Changes

### 1. Register Form (register-form.tsx)
```diff
- router.push(`/verify?phone=${encodeURIComponent(phone)}`);
+ const normalizedPhone = payload?.data?.phone || trimmedPhone;
+ router.push(`/verify?phone=${encodeURIComponent(normalizedPhone)}`);
```
**Impact**: Now passes normalized phone from API, ensuring consistency

### 2. OTPVerify Schema (auth.py)
```diff
class OTPVerify(BaseModel):
    phone: str
+   @validator('phone')
+   def validate_phone(cls, v):
+       return normalize_phone_number(v)
    otp: str = Field(..., min_length=4, max_length=6)
```
**Impact**: Backend normalizes phone before cache lookup

### 3. Enhanced Logging (auth.py)
```python
logger.info(f"Storing OTP in Redis: key={cache_key}, otp={otp_value}, type={otp_type}")
# ... later ...
logger.info(f"Attempting to verify OTP - phone: {normalized_phone}, cache_key: {cache_key}")
logger.info(f"OTP found in Redis: stored_otp={cached_data.get('otp')}, provided_otp={otp_data.otp}")
```
**Impact**: Easy debugging - can see exactly what's happening

### 4. Debug Endpoint (auth.py)  
```python
@router.get("/debug/otp/{phone}")
async def debug_otp(phone: str):
    # Returns: {normalized_phone, cache_key, otp_data, otp_exists}
```
**Impact**: Can inspect Redis/cache state anytime

## Phone Normalization Reference

```javascript
// Frontend: All these inputs → "+919876543210"
normalizePhone("9876543210")      // 10-digit local
normalizePhone("919876543210")    // 12-digit with country
normalizePhone("+919876543210")   // Already E.164
normalizePhone("+91-9876543210")  // With formatting
```

## Cache Key Pattern

```
Format: "otp:{normalized_phone}"

Examples:
- Input: "9876543210" → Key: "otp:+919876543210"
- Input: "+919876543210" → Key: "otp:+919876543210"
- Input: "919876543210" → Key: "otp:+919876543210"

All normalize to same key ✓
```

## Testing Verification

| Step | Before | After |
|------|--------|-------|
| Register with "9176358376" | ✓ Works | ✓ Works |
| API returns data.phone | "+919176358376" | "+919176358376" |
| URL parameter phone | "9176358376" ❌ | "+919176358376" ✓ |
| Backend cache key | "otp:+919176358376" | "otp:+919176358376" |
| Verify lookup key | "otp:9176358376" ❌ | "otp:+919176358376" ✓ |
| OTP found | ❌ No (mismatch) | ✓ Yes (match) |
| Verify result | ❌ 400 Error | ✓ 200 Success |

## Why This Fix Works

1. **Single Source of Truth**: API response phone is the canonical normalized value
2. **Consistent Normalization**: Same function used everywhere (backend + frontend)
3. **Idempotent**: Normalizing "+919876543210" again → "+919876543210" (no change)
4. **No Silent Failures**: Enhanced logging shows exact values at each step
5. **Fallback Support**: In-memory cache works when Redis unavailable

## Deployment Notes

- No database migrations needed
- No new dependencies  
- No breaking changes
- Works with existing Redis OR in-memory fallback
- SMS delivery still requires Twilio (or dev fallback)
