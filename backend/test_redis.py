# test_redis.py
import redis

REDIS_URL = "redis://default:CAHvhmKauAeWWVJNB55m9MQ3edDSqwBf@pump-sound-dogs-97271.db.redis.io:10029"

try:
    r = redis.Redis.from_url(REDIS_URL)
    r.ping()
    print("✅ Redis Cloud connected successfully!")
    
    # Test set/get
    r.set("test", "working")
    print(f"✅ Test value: {r.get('test')}")
    
except Exception as e:
    print(f"❌ Error: {str(e)}")