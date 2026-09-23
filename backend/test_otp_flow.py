#!/usr/bin/env python
"""Test OTP and Redis connectivity."""

import asyncio
import sys
from app.database.redis import RedisClient
from app.utils.helpers import normalize_phone_number
from app.core.security import Security
from app.services.notification_service import NotificationService

async def test_redis():
    """Test Redis connectivity."""
    print("Testing Redis connectivity...")
    try:
        # Try to ping Redis
        await RedisClient.set_cache("test_key", {"test": "value"}, ttl=60)
        result = await RedisClient.get_cache("test_key")
        print(f"✓ Redis working: {result}")
        await RedisClient.delete_cache("test_key")
        return True
    except Exception as e:
        print(f"✗ Redis failed: {e}")
        return False

async def test_otp_generation():
    """Test OTP generation."""
    print("\nTesting OTP generation...")
    try:
        otp = Security.generate_otp()
        print(f"✓ OTP generated: {otp}")
        return otp
    except Exception as e:
        print(f"✗ OTP generation failed: {e}")
        return None

async def test_phone_normalization():
    """Test phone number normalization."""
    print("\nTesting phone normalization...")
    test_phones = [
        "9176358376",
        "+919176358376",
        "919176358376",
        "+91-9176358376",
    ]
    
    for phone in test_phones:
        try:
            normalized = normalize_phone_number(phone)
            print(f"✓ {phone:20} → {normalized}")
        except Exception as e:
            print(f"✗ {phone:20} → ERROR: {e}")

async def test_otp_storage():
    """Test OTP storage in Redis."""
    print("\nTesting OTP storage...")
    try:
        phone = "+919176358376"
        otp = Security.generate_otp()
        cache_key = f"otp:{phone}"
        
        # Store OTP
        await RedisClient.set_cache(cache_key, {"otp": otp, "type": "test"}, ttl=300)
        print(f"✓ OTP stored: key={cache_key}, otp={otp}")
        
        # Retrieve OTP
        retrieved = await RedisClient.get_cache(cache_key)
        print(f"✓ OTP retrieved: {retrieved}")
        
        # Verify match
        if retrieved and retrieved.get("otp") == otp:
            print(f"✓ OTP matches!")
        else:
            print(f"✗ OTP mismatch!")
            
        # Cleanup
        await RedisClient.delete_cache(cache_key)
        return True
    except Exception as e:
        print(f"✗ OTP storage test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_sms_send():
    """Test SMS sending."""
    print("\nTesting SMS sending...")
    try:
        result = await NotificationService.send_sms("+919176358376", "Test OTP: 123456")
        print(f"✓ SMS result: {result}")
        return result
    except Exception as e:
        print(f"✗ SMS send failed: {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    """Run all tests."""
    print("=" * 50)
    print("OTP and Redis Test Suite")
    print("=" * 50)
    
    tests = [
        ("Redis", test_redis()),
        ("OTP Generation", test_otp_generation()),
        ("Phone Normalization", test_phone_normalization()),
        ("OTP Storage", test_otp_storage()),
        ("SMS Send", test_sms_send()),
    ]
    
    results = []
    for name, test in tests:
        if asyncio.iscoroutine(test):
            result = await test
        else:
            result = test
        results.append((name, result))
    
    print("\n" + "=" * 50)
    print("Test Summary")
    print("=" * 50)
    for name, result in results:
        status = "✓" if result else "✗"
        print(f"{status} {name}")

if __name__ == "__main__":
    asyncio.run(main())
