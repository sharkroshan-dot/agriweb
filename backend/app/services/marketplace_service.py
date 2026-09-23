from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
from app.database.mongodb import MongoDB
from app.utils.helpers import escape_regex
import logging

logger = logging.getLogger(__name__)

farmer_repo = BaseRepository("farmer_profiles")
product_repo = BaseRepository("products")
user_repo = BaseRepository("users")
order_repo = BaseRepository("orders")

class MarketplaceService:
    @staticmethod
    async def get_products_nearby(
        lat: float, lng: float, radius: int,
        category: Optional[str] = None,
        search: Optional[str] = None
    ) -> Dict[str, Any]:
        pipeline = [
            {
                "$geoNear": {
                    "near": {"type": "Point", "coordinates": [lng, lat]},
                    "distanceField": "distance",
                    "maxDistance": radius * 1000,
                    "spherical": True
                }
            },
            {"$match": {"isAvailable": True, "deletedAt": None}},
            {
                "$lookup": {
                    "from": "users",
                    "localField": "userId",
                    "foreignField": "_id",
                    "as": "user"
                }
            },
            {"$unwind": {"path": "$user", "preserveNullAndEmptyArrays": True}},
            {
                "$lookup": {
                    "from": "products",
                    "let": {"farmer_id": "$userId"},
                    "pipeline": [
                        {"$match": {"$expr": {"$eq": ["$farmerId", "$$farmer_id"]}, "isActive": True, "deletedAt": None, "isBasketOnly": {"$ne": True}}},
                    ],
                    "as": "products"
                }
            },
        ]
        if category:
            pipeline.append({"$match": {"products.category": category}})
        if search:
            pipeline.append({"$match": {"products.name": {"$regex": escape_regex(search), "$options": "i"}}})

        pipeline.append({"$limit": 50})

        farmers = await farmer_repo.aggregate(pipeline)
        for f in farmers:
            f["id"] = str(f.get("_id"))
            f["distanceKm"] = round(f.get("distance", 0) / 1000, 2)
            for p in f.get("products", []):
                p["id"] = str(p.get("_id"))
                p["distanceKm"] = f["distanceKm"]
                p["pickupAvailable"] = p.get("pickupAvailable", False)
                p["farmAddress"] = p.get("farmAddress", "")
                p["farmDistanceKm"] = f["distanceKm"]

        return {"farmers": farmers, "count": len(farmers)}

    @staticmethod
    async def get_products_by_state(
        state: str,
        district: Optional[str] = None,
        city: Optional[str] = None,
        country: Optional[str] = None,
        category: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:
        skip = (page - 1) * limit
        match: Dict[str, Any] = {"state": state, "isActive": True, "deletedAt": None, "isBasketOnly": {"$ne": True}}
        if district:
            match["district"] = district
        if city:
            match["city"] = city
        if country:
            match["country"] = country
        if category:
            match["category"] = category
        if search:
            match["name"] = {"$regex": search, "$options": "i"}

        pipeline = [
            {"$match": match},
            {
                "$lookup": {
                    "from": "farmer_profiles",
                    "localField": "farmerId",
                    "foreignField": "userId",
                    "as": "farmer"
                }
            },
            {"$unwind": {"path": "$farmer", "preserveNullAndEmptyArrays": True}},
            {
                "$group": {
                    "_id": "$district",
                    "products": {"$push": "$$ROOT"},
                    "count": {"$sum": 1}
                }
            },
            {"$sort": {"_id": 1}},
        ]

        districts_grouped = await product_repo.aggregate(pipeline)

        total = 0
        districts_list = []
        products_flat = []
        for d in districts_grouped:
            total += d["count"]
            districts_list.append({"district": d["_id"], "count": d["count"]})
            for p in d.get("products", []):
                p["id"] = str(p.get("_id"))
                products_flat.append(p)

        paginated = products_flat[skip:skip + limit]

        return {
            "districts": districts_list,
            "products": paginated,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": max(1, (total + limit - 1) // limit)
            }
        }

    @staticmethod
    async def get_products_national(
        country: Optional[str] = None,
        state: Optional[str] = None,
        district: Optional[str] = None,
        city: Optional[str] = None,
        category: Optional[str] = None,
        sort_by: str = "createdAt",
        search: Optional[str] = None,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:
        skip = (page - 1) * limit
        match: Dict[str, Any] = {"isActive": True, "deletedAt": None, "isBasketOnly": {"$ne": True}}
        if country:
            match["country"] = country
        if state:
            match["state"] = state
        if district:
            match["district"] = district
        if city:
            match["city"] = city
        if category:
            match["category"] = category
        if search:
            match["name"] = {"$regex": escape_regex(search), "$options": "i"}

        sort_field = sort_by if sort_by in ("price", "rating", "createdAt") else "createdAt"
        sort_dir = -1 if sort_by == "price" else -1

        pipeline = [
            {"$match": match},
            {
                "$lookup": {
                    "from": "farmer_profiles",
                    "localField": "farmerId",
                    "foreignField": "userId",
                    "as": "farmer"
                }
            },
            {"$unwind": {"path": "$farmer", "preserveNullAndEmptyArrays": True}},
            {
                "$lookup": {
                    "from": "users",
                    "localField": "farmerId",
                    "foreignField": "_id",
                    "as": "farmerUser"
                }
            },
            {"$unwind": {"path": "$farmerUser", "preserveNullAndEmptyArrays": True}},
            {"$sort": {sort_field: sort_dir}},
            {"$skip": skip},
            {"$limit": limit},
            {
                "$group": {
                    "_id": "$state",
                    "products": {"$push": "$$ROOT"},
                    "count": {"$sum": 1}
                }
            },
            {"$sort": {"_id": 1}},
        ]

        grouped = await product_repo.aggregate(pipeline)

        for g in grouped:
            for p in g.get("products", []):
                p["id"] = str(p.get("_id"))
                p["shippingAvailable"] = p.get("farmer", {}).get("shippingAvailable", False)
                p["pickupAvailable"] = p.get("pickupAvailable", False)
                p["farmAddress"] = p.get("farmAddress", "")
                farmer_info = p.get("farmerUser", {})
                p["farmerInfo"] = {
                    "name": f"{farmer_info.get('firstName', '')} {farmer_info.get('lastName', '')}".strip(),
                    "phone": farmer_info.get("phone"),
                    "rating": p.get("farmer", {}).get("rating"),
                }

        total_pipeline = [{"$match": match}, {"$count": "total"}]
        total_result = await product_repo.aggregate(total_pipeline)
        total = total_result[0]["total"] if total_result else 0

        return {
            "states": grouped,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": max(1, (total + limit - 1) // limit)
            }
        }

    @staticmethod
    async def get_country_list() -> Dict[str, Any]:
        """Static list of supported countries."""
        from app.core.constants import COUNTRIES
        return {"countries": COUNTRIES, "count": len(COUNTRIES)}

    @staticmethod
    async def get_state_list(country: Optional[str] = None) -> Dict[str, Any]:
        """States for a country. For India uses the canonical list; otherwise
        states derived from products that actually exist in that country."""
        from app.core.constants import INDIAN_STATES

        if not country or country.lower() in ("india", "bharat", "in"):
            return {"country": country or "India", "states": INDIAN_STATES, "count": len(INDIAN_STATES)}

        match: Dict[str, Any] = {"country": country, "isActive": True, "deletedAt": None, "isBasketOnly": {"$ne": True}}
        pipeline = [
            {"$match": match},
            {"$match": {"state": {"$ne": None}}},
            {"$match": {"state": {"$ne": ""}}},
            {"$group": {"_id": "$state"}},
            {"$sort": {"_id": 1}},
        ]
        rows = await product_repo.aggregate(pipeline)
        states = [r["_id"] for r in rows if r.get("_id")]
        return {"country": country, "states": states, "count": len(states)}

    @staticmethod
    async def get_district_list(country: Optional[str], state: str) -> Dict[str, Any]:
        """Districts for a state. For India uses the canonical list; otherwise
        districts derived from products that actually exist in that state."""
        from app.core.constants import INDIAN_DISTRICTS

        if not country or country.lower() in ("india", "bharat", "in"):
            districts = INDIAN_DISTRICTS.get(state, [])
            return {"country": country or "India", "state": state, "districts": districts, "count": len(districts)}

        match: Dict[str, Any] = {"country": country, "state": state, "isActive": True, "deletedAt": None, "isBasketOnly": {"$ne": True}}
        pipeline = [
            {"$match": match},
            {"$match": {"district": {"$ne": None}}},
            {"$match": {"district": {"$ne": ""}}},
            {"$group": {"_id": "$district"}},
            {"$sort": {"_id": 1}},
        ]
        rows = await product_repo.aggregate(pipeline)
        districts = [r["_id"] for r in rows if r.get("_id")]
        return {"country": country, "state": state, "districts": districts, "count": len(districts)}

    @staticmethod
    async def get_city_list(state: str, district: Optional[str] = None) -> Dict[str, Any]:
        """Distinct cities that actually have products for the given state/district."""
        match: Dict[str, Any] = {"state": state, "isActive": True, "deletedAt": None, "isBasketOnly": {"$ne": True}}
        if district:
            match["district"] = district
        pipeline = [
            {"$match": match},
            {"$match": {"city": {"$ne": None}}},
            {"$match": {"city": {"$ne": ""}}},
            {"$group": {"_id": "$city"}},
            {"$sort": {"_id": 1}},
        ]
        rows = await product_repo.aggregate(pipeline)
        cities = [r["_id"] for r in rows if r.get("_id")]
        return {"state": state, "district": district, "cities": cities, "count": len(cities)}

    @staticmethod
    async def get_nearby_customers(
        farmer_id: str,
        lat: float,
        lng: float,
        radius: int
    ) -> Dict[str, Any]:
        orders_pipeline = [
            {"$match": {"farmerId": ObjectId(farmer_id), "deletedAt": None}},
            {"$group": {"_id": "$customerId", "orderCount": {"$sum": 1}, "lastOrder": {"$max": "$createdAt"}}},
        ]
        customer_ids = await order_repo.aggregate(orders_pipeline)

        if not customer_ids:
            return {"customers": [], "groups": [], "count": 0}

        ids = [c["_id"] for c in customer_ids if c.get("_id")]

        geo_pipeline = [
            {
                "$geoNear": {
                    "near": {"type": "Point", "coordinates": [lng, lat]},
                    "distanceField": "distance",
                    "maxDistance": radius * 1000,
                    "spherical": True
                }
            },
            {"$match": {"_id": {"$in": ids}, "deletedAt": None}},
            {
                "$lookup": {
                    "from": "users",
                    "localField": "_id",
                    "foreignField": "_id",
                    "as": "user"
                }
            },
            {"$unwind": {"path": "$user", "preserveNullAndEmptyArrays": True}},
            {"$limit": 100},
        ]

        customers = await user_repo.aggregate(geo_pipeline)
        for c in customers:
            c["id"] = str(c.get("_id"))
            c["distanceKm"] = round(c.get("distance", 0) / 1000, 2)

        clusters = {}
        for c in customers:
            dist = c.get("distanceKm", 0)
            key = round(dist / 5) * 5
            if key not in clusters:
                clusters[key] = {"range": f"{key}-{key+5} km", "customers": [], "count": 0}
            clusters[key]["customers"].append(c)
            clusters[key]["count"] += 1

        groups = sorted(clusters.values(), key=lambda x: int(x["range"].split("-")[0]))

        return {"customers": customers, "groups": groups, "count": len(customers)}


marketplace_service = MarketplaceService()
