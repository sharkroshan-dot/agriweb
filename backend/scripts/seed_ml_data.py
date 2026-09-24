"""Development-only MongoDB ML sample seeder."""

import argparse
import asyncio
from datetime import datetime, timedelta, timezone

from bson import ObjectId

from app.database.mongodb import MongoDB


SOURCE = "agriconnect-ml-dev-seed"


def make_order(i, now):
    created = now - timedelta(
        days=i % 75,
        hours=i % 8,
    )

    requested = created + timedelta(
        hours=2 + i % 8
    )

    # Around 20% of samples are deliberately late.
    # This gives the delivery classifier both classes.
    late = i % 5 == 0

    delivered = requested + timedelta(
        minutes=(35 + i % 50)
        if late
        else -(10 + i % 20)
    )

    quantity = float(2 + i % 18)
    price = float(15 + (i % 8) * 3)

    return {
        "orderNumber": f"ML-SEED-{now:%Y%m%d}-{i:04d}",

        "customer_id": ObjectId(),
        "farmer_id": ObjectId(),

        "status": "delivered",
        "orderStatus": "delivered",

        "createdAt": created,
        "orderDate": created,

        "requestedDeliveryDate": requested,
        "deliveredAt": delivered,

        "totalAmount": round(
            quantity * price,
            2,
        ),

        "paymentMethod": (
            "cash"
            if i % 3 == 0
            else "online"
        ),

        "items": [
            {
                "productId": ObjectId(),
                "productName": [
                    "Tomato",
                    "Onion",
                    "Potato",
                    "Carrot",
                ][i % 4],
                "quantity": quantity,
                "price": price,
            }
        ],

        # Exactly the feature vector expected by
        # DeliveryRiskModel.
        "deliveryRiskFeatures": {
            "distance_km": float(2 + i % 25),

            "time_window_minutes": float(
                30 + (i % 8) * 30
            ),

            "is_cod": (
                1.0
                if i % 3 == 0
                else 0.0
            ),

            "quantity_kg": quantity,

            "vehicle_capacity": float(
                20 + (i % 3) * 10
            ),

            "partner_on_time_rate": round(
                0.70 + (i % 30) / 100,
                3,
            ),

            "partner_rating": round(
                3.5 + (i % 15) / 10,
                2,
            ),

            "partner_active_load": float(
                i % 10
            ),

            "previous_delays": float(
                i % 4
            ),

            "rural_roads": float(
                i % 11
            ),
        },

        # Clearly identify development data.
        "mlTrainingSample": True,
        "mlSeedSource": SOURCE,
    }


def make_price(i, now):
    return {
        "date": now - timedelta(
            days=i % 75,
            hours=i % 12,
        ),

        "price": float(
            10 + (i % 12) * 4 + i % 3
        ),

        "product_id": str(ObjectId()),

        "demand_score": round(
            (i % 10) / 10,
            3,
        ),

        "weather_score": round(
            (i % 7) / 7,
            3,
        ),

        "competition_score": round(
            (i % 6) / 6,
            3,
        ),

        "mlTrainingSample": True,
        "mlSeedSource": SOURCE,
    }


async def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--orders",
        type=int,
        default=60,
    )

    parser.add_argument(
        "--prices",
        type=int,
        default=60,
    )

    parser.add_argument(
        "--reset",
        action="store_true",
    )

    args = parser.parse_args()

    if args.orders < 40:
        raise SystemExit(
            "--orders must be at least 40"
        )

    if args.prices < 30:
        raise SystemExit(
            "--prices must be at least 30"
        )

    await MongoDB.connect()

    db = MongoDB.db

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Remove only records created by this seeder.
    if args.reset:

        await db.orders.delete_many(
            {
                "mlTrainingSample": True,
                "mlSeedSource": SOURCE,
            }
        )

        await db.price_history.delete_many(
            {
                "mlTrainingSample": True,
                "mlSeedSource": SOURCE,
            }
        )

    orders = [
        make_order(i, now)
        for i in range(
            1,
            args.orders + 1,
        )
    ]

    prices = [
        make_price(i, now)
        for i in range(
            1,
            args.prices + 1,
        )
    ]

    await db.orders.insert_many(
        orders,
        ordered=False,
    )

    await db.price_history.insert_many(
        prices,
        ordered=False,
    )

    print(
        {
            "status": "success",
            "orders_inserted": len(orders),
            "prices_inserted": len(prices),
            "delivery_training_samples": len(orders),
            "seed_source": SOURCE,
        }
    )

    await MongoDB.close()


if __name__ == "__main__":
    asyncio.run(main())