"""One-time backfill: derive state/district/city for existing products.

Parses the Nominatim-style `location.address` string already stored on each
product (e.g. 'Manachanallur, Tiruchirappalli, Tamil Nadu, India') and writes
the extracted state/district/city back onto the product document.

Run from the backend directory:  python scripts/backfill_product_location.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

from app.database.mongodb import MongoDB
from app.core.constants import INDIAN_STATES


def parse_address(address: str) -> dict:
    parts = [p.strip() for p in (address or "").split(",") if p.strip()]
    if len(parts) < 2:
        return {}
    state_hint = parts[-1]
    if state_hint.lower() in ("india", "bharat", "in") and len(parts) >= 2:
        state_hint = parts[-2]
    matched_state = next((s for s in INDIAN_STATES if s.lower() == state_hint.lower()), "")
    if not matched_state:
        matched_state = next((s for s in INDIAN_STATES if s.lower() in state_hint.lower()), "")
    if not matched_state:
        return {}
    district_hint = parts[-2] if (parts[-1].lower() in ("india", "bharat", "in")) else parts[-1]
    if district_hint.lower() == matched_state.lower() and len(parts) >= 3:
        district_hint = parts[-3]
    district_hint = district_hint.replace(" district", "").replace(" District", "")
    return {
        "state": matched_state,
        "district": district_hint,
        "city": parts[0],
    }


async def main() -> None:
    await MongoDB.connect()
    db = MongoDB.db
    cursor = db.products.find({"deletedAt": None})
    updated = 0
    skipped = 0
    async for product in cursor:
        loc = product.get("location") or {}
        address = loc.get("address") or "" if isinstance(loc, dict) else ""
        if not address:
            skipped += 1
            continue
        parsed = parse_address(address)
        if not parsed.get("state"):
            skipped += 1
            continue
        update = {}
        if not product.get("state"):
            update["state"] = parsed["state"]
        if not product.get("district"):
            update["district"] = parsed["district"]
        if not product.get("city"):
            update["city"] = parsed["city"]
        if update:
            update["updatedAt"] = __import__("datetime").datetime.utcnow()
            await db.products.update_one({"_id": product["_id"]}, {"$set": update})
            updated += 1
            print(f"  -> {product.get('name')}: {parsed}")
        else:
            skipped += 1
    print(f"\nUpdated {updated} products, skipped {skipped}.")
    await MongoDB.close()


if __name__ == "__main__":
    asyncio.run(main())
