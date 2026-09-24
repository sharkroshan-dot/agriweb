import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.mongodb import MongoDB


async def main():
    await MongoDB.connect()

    orders = await MongoDB.db.orders.count_documents({
        "mlTrainingSample": True,
        "mlSeedSource": "agriconnect-ml-dev-seed",
    })

    prices = await MongoDB.db.price_history.count_documents({
        "mlTrainingSample": True,
        "mlSeedSource": "agriconnect-ml-dev-seed",
    })

    print(f"Orders: {orders}")
    print(f"Prices: {prices}")

    await MongoDB.close()


if __name__ == "__main__":
    asyncio.run(main())
