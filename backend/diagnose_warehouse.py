import asyncio
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings


ORDER_ID = "6ad0955344b376418b1ccd79"
FARMER_ID = "6a509240475f52463b1b42ab"


async def main():
    uri = settings.MONGODB_URI

    if settings.MONGODB_USER and settings.MONGODB_PASSWORD:
        uri = uri.replace(
            "mongodb://",
            f"mongodb://{settings.MONGODB_USER}:{settings.MONGODB_PASSWORD}@",
            1,
        )

    client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=10000)

    try:
        await client.admin.command("ping")
        db = client[settings.MONGODB_DATABASE]

        order = await db["orders"].find_one(
            {"_id": ObjectId(ORDER_ID)},
            {
                "farmerId": 1,
                "farmer_id": 1,
                "warehouseId": 1,
                "fulfillmentMethod": 1,
                "orderStatus": 1,
            },
        )
        print("\n--- ORDER ---")
        print(order)

        farmer_profile = await db["farmer_profiles"].find_one(
            {
                "$or": [
                    {"userId": ObjectId(FARMER_ID)},
                    {"userId": FARMER_ID},
                    {"_id": ObjectId(FARMER_ID)},
                ]
            }
        )
        print("\n--- FARMER PROFILE ---")
        print(farmer_profile)

        warehouses = await db["warehouses"].find(
            {},
            {
                "name": 1,
                "address": 1,
                "location": 1,
                "serviceAreas": 1,
                "isActive": 1,
                "deletedAt": 1,
                "managerId": 1,
                "userId": 1,
                "farmerId": 1,
                "district": 1,
                "city": 1,
            },
        ).to_list(length=200)

        print(f"\n--- WAREHOUSES ({len(warehouses)}) ---")
        for warehouse in warehouses:
            print(warehouse)

    finally:
        client.close()


asyncio.run(main())
