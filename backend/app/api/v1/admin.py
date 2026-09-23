from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime, timedelta
from bson import ObjectId
import logging

from app.database.mongodb import MongoDB
from app.core.security import require_role
from app.schemas.complaint import ComplaintUpdate
from app.utils.helpers import escape_regex

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/dashboard")
async def admin_dashboard(current_user: dict = Depends(require_role("admin"))):
    users_coll = MongoDB.get_collection("users")
    products_coll = MongoDB.get_collection("products")
    orders_coll = MongoDB.get_collection("orders")
    complaints_coll = MongoDB.get_collection("complaints")
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)

    total_users = await users_coll.count_documents({})
    total_farmers = await users_coll.count_documents({"role": "farmer"})
    total_customers = await users_coll.count_documents({"role": "customer"})
    total_delivery = await users_coll.count_documents({"role": "delivery"})
    total_warehouse = await users_coll.count_documents({"role": "warehouse"})
    total_admins = await users_coll.count_documents({"role": "admin"})
    total_products = await products_coll.count_documents({"deletedAt": None})
    total_orders = await orders_coll.count_documents({})
    today_orders = await orders_coll.count_documents({"createdAt": {"$gte": today_start}})
    pending_orders = await orders_coll.count_documents({"orderStatus": "pending"})
    total_revenue_agg = await orders_coll.aggregate([
        {"$match": {"paymentStatus": "completed"}},
        {"$group": {"_id": None, "total": {"$sum": "$totalAmount"}}}
    ]).to_list(1)
    total_revenue = total_revenue_agg[0]["total"] if total_revenue_agg else 0
    pending_farmers = await users_coll.count_documents({"role": "farmer", "isVerified": False})
    pending_complaints = await complaints_coll.count_documents({"status": "pending"})

    orders_pipeline = [
        {"$match": {"createdAt": {"$gte": week_start}}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$createdAt"}}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}}
    ]
    orders_trend = await orders_coll.aggregate(orders_pipeline).to_list(100)

    # Marketplace level distribution: orders whose items come from a single
    # state are "state" level, multiple states are "national", and orders
    # without product-state info are treated as local ("nearby").
    marketplace_pipeline = [
        {"$match": {"deletedAt": None}},
        {"$unwind": "$items"},
        {"$lookup": {
            "from": "products",
            "localField": "items.productId",
            "foreignField": "_id",
            "as": "prod"
        }},
        {"$unwind": {"path": "$prod", "preserveNullAndEmptyArrays": True}},
        {"$group": {
            "_id": "$_id",
            "states": {"$addToSet": "$prod.state"}
        }}
    ]
    marketplace = {"nearby": 0, "state": 0, "national": 0}
    order_state_rows = await orders_coll.aggregate(marketplace_pipeline).to_list(5000)
    for row in order_state_rows:
        valid_states = [s for s in row.get("states", []) if s]
        if len(valid_states) == 0:
            marketplace["nearby"] += 1
        elif len(valid_states) == 1:
            marketplace["state"] += 1
        else:
            marketplace["national"] += 1

    # Recent admin-relevant activity aggregated from existing collections.
    activity = []

    complaint_cursor = complaints_coll.find(
        {"adminResponse": {"$ne": None}}
    ).sort("updatedAt", -1).limit(5)
    for c in await complaint_cursor.to_list(length=5):
        activity.append({
            "type": "complaint",
            "title": "Complaint responded",
            "description": f"Replied to complaint #{str(c['_id'])[-6:]}",
            "timestamp": (c.get("updatedAt") or c.get("createdAt") or now).isoformat()
        })

    product_cursor = products_coll.find({"deletedAt": None}).sort("updatedAt", -1).limit(5)
    for p in await product_cursor.to_list(length=5):
        activity.append({
            "type": "product",
            "title": "Product updated",
            "description": f"\"{p.get('name', 'Unknown product')}\" was updated",
            "timestamp": (p.get("updatedAt") or p.get("createdAt") or now).isoformat()
        })

    farmer_cursor = users_coll.find(
        {"role": "farmer", "isVerified": True}
    ).sort("updatedAt", -1).limit(5)
    for f in await farmer_cursor.to_list(length=5):
        name = f"{f.get('firstName', '')} {f.get('lastName', '')}".strip() or "a farmer"
        activity.append({
            "type": "farmer",
            "title": "Farmer profile updated",
            "description": f"Verified farmer {name}",
            "timestamp": (f.get("updatedAt") or f.get("createdAt") or now).isoformat()
        })

    order_cursor = orders_coll.find({"deletedAt": None}).sort("createdAt", -1).limit(5)
    for o in await order_cursor.to_list(length=5):
        amount = o.get("totalAmount") or 0
        activity.append({
            "type": "order",
            "title": "New order placed",
            "description": f"Order #{o.get('orderNumber') or str(o['_id'])[-6:]} for ₹{amount:,.2f}",
            "timestamp": (o.get("createdAt") or now).isoformat()
        })

    activity.sort(key=lambda a: a["timestamp"], reverse=True)
    recent_activity = activity[:8]

    return {
        "stats": {
            "totalUsers": total_users,
            "totalFarmers": total_farmers,
            "totalCustomers": total_customers,
            "totalDelivery": total_delivery,
            "totalWarehouse": total_warehouse,
            "totalAdmins": total_admins,
            "totalProducts": total_products,
            "totalOrders": total_orders,
            "todayOrders": today_orders,
            "pendingOrders": pending_orders,
            "totalRevenue": total_revenue,
            "pendingFarmers": pending_farmers,
            "pendingComplaints": pending_complaints
        },
        "ordersTrend": [
            {"date": entry["_id"], "count": entry["count"]}
            for entry in orders_trend
        ],
        "marketplace": marketplace,
        "recentActivity": recent_activity
    }

@router.get("/dashboard/regions")
async def demand_heatmap_regions(current_user: dict = Depends(require_role("admin"))):
    """Regional demand intensity derived from real order + product data."""
    orders_coll = MongoDB.get_collection("orders")
    pipeline = [
        {"$match": {"deletedAt": None}},
        {"$unwind": "$items"},
        {"$lookup": {
            "from": "products",
            "localField": "items.productId",
            "foreignField": "_id",
            "as": "prod"
        }},
        {"$unwind": {"path": "$prod", "preserveNullAndEmptyArrays": True}},
        {"$match": {
            "prod.state": {"$nin": [None, ""]},
            "prod.name": {"$nin": [None, ""]}
        }},
        {"$group": {
            "_id": {"state": "$prod.state", "product": "$prod.name"},
            "cnt": {"$sum": 1}
        }},
        {"$sort": {"cnt": -1}},
        {"$group": {
            "_id": "$_id.state",
            "orderCount": {"$sum": "$cnt"},
            "topProduct": {"$first": "$_id.product"}
        }},
        {"$sort": {"orderCount": -1}}
    ]
    rows = await orders_coll.aggregate(pipeline).to_list(200)
    if not rows:
        return {"locations": []}

    max_count = max(r["orderCount"] for r in rows) or 1
    locations = []
    for r in rows:
        ratio = r["orderCount"] / max_count
        if ratio >= 0.7:
            demand = "high"
        elif ratio >= 0.4:
            demand = "medium"
        else:
            demand = "low"
        locations.append({
            "name": r["_id"],
            "demand": demand,
            "topProduct": r.get("topProduct") or "N/A",
            "orderCount": r["orderCount"]
        })
    return {"locations": locations}

@router.get("/farmers")
async def list_farmers(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    isVerified: Optional[bool] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(require_role("admin"))
):
    query = {"role": "farmer"}
    if isVerified is not None:
        query["isVerified"] = isVerified
    if search:
        safe = escape_regex(search)
        query["$or"] = [
            {"firstName": {"$regex": safe, "$options": "i"}},
            {"lastName": {"$regex": safe, "$options": "i"}},
            {"email": {"$regex": safe, "$options": "i"}},
            {"phone": {"$regex": safe, "$options": "i"}}
        ]
    collection = MongoDB.get_collection("users")
    total = await collection.count_documents(query)
    cursor = collection.find(query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    farmers = await cursor.to_list(length=limit)
    return {
        "farmers": [{**f, "id": str(f["_id"])} for f in farmers],
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@router.put("/farmers/{farmer_id}/verify")
async def verify_farmer(farmer_id: str, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection("users")
    result = await collection.find_one_and_update(
        {"_id": ObjectId(farmer_id), "role": "farmer"},
        {"$set": {"isVerified": True, "updatedAt": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "Farmer not found")
    return {"message": "Farmer verified successfully"}

@router.put("/farmers/{farmer_id}/reject")
async def reject_farmer(farmer_id: str, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection("users")
    result = await collection.find_one_and_update(
        {"_id": ObjectId(farmer_id), "role": "farmer"},
        {"$set": {"isVerified": False, "updatedAt": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "Farmer not found")
    return {"message": "Farmer rejected"}

@router.get("/products")
async def list_all_products(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    isActive: Optional[bool] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(require_role("admin"))
):
    query = {"deletedAt": None}
    if isActive is not None:
        query["isActive"] = isActive
    if search:
        query["name"] = {"$regex": escape_regex(search), "$options": "i"}
    collection = MongoDB.get_collection("products")
    total = await collection.count_documents(query)
    cursor = collection.find(query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    products = await cursor.to_list(length=limit)
    return {
        "products": [{**p, "id": str(p["_id"])} for p in products],
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@router.put("/products/{product_id}/approve")
async def approve_product(product_id: str, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection("products")
    result = await collection.find_one_and_update(
        {"_id": ObjectId(product_id)},
        {"$set": {"isActive": True, "updatedAt": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "Product not found")
    return {"message": "Product approved"}

@router.put("/products/{product_id}/reject")
async def reject_product(product_id: str, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection("products")
    result = await collection.find_one_and_update(
        {"_id": ObjectId(product_id)},
        {"$set": {"isActive": False, "updatedAt": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "Product not found")
    return {"message": "Product rejected"}

@router.get("/orders")
async def list_all_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    orderStatus: Optional[str] = None,
    paymentStatus: Optional[str] = None,
    current_user: dict = Depends(require_role("admin"))
):
    query = {}
    if orderStatus:
        query["orderStatus"] = orderStatus
    if paymentStatus:
        query["paymentStatus"] = paymentStatus
    collection = MongoDB.get_collection("orders")
    total = await collection.count_documents(query)
    cursor = collection.find(query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    orders = await cursor.to_list(length=limit)

    # Enrich orders with Proof of Delivery (POD) data from the delivery assignments
    assignment_by_order = {}
    if orders:
        assignments_coll = MongoDB.get_collection("delivery_assignments")
        order_ids = [o["_id"] for o in orders]
        assignments = await assignments_coll.find(
            {"orderId": {"$in": order_ids}, "deletedAt": None}
        ).to_list(length=len(order_ids))
        for assignment in assignments:
            order_id = str(assignment.get("orderId"))
            if order_id and order_id not in assignment_by_order:
                assignment_by_order[order_id] = assignment

    enriched = []
    for o in orders:
        item = {**o, "id": str(o["_id"])}
        assignment = assignment_by_order.get(str(o["_id"]))
        if assignment:
            proof = assignment.get("proofOfDelivery") or {}
            item["pod"] = {
                "photoUrl": proof.get("photoUrl") or assignment.get("deliveryPhoto"),
                "recipientName": proof.get("recipientName"),
                "signature": proof.get("signature"),
                "uploadedAt": proof.get("uploadedAt"),
                "completedAt": assignment.get("completedAt"),
            }
        enriched.append(item)

    return {
        "orders": enriched,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@router.get("/reports")
async def generate_reports(
    period: str = Query("weekly"),
    current_user: dict = Depends(require_role("admin"))
):
    orders_coll = MongoDB.get_collection("orders")
    users_coll = MongoDB.get_collection("users")
    farmer_profiles_coll = MongoDB.get_collection("farmer_profiles")
    now = datetime.utcnow()
    if period == "daily":
        start = now - timedelta(days=1)
    elif period == "weekly":
        start = now - timedelta(days=7)
    elif period == "monthly":
        start = now - timedelta(days=30)
    elif period == "yearly":
        start = now - timedelta(days=365)
    else:
        start = now - timedelta(days=7)

    total_revenue_agg = await orders_coll.aggregate([
        {"$match": {"paymentStatus": "completed", "createdAt": {"$gte": start}}},
        {"$group": {"_id": None, "total": {"$sum": "$totalAmount"}}}
    ]).to_list(1)
    total_revenue = total_revenue_agg[0]["total"] if total_revenue_agg else 0

    total_orders = await orders_coll.count_documents({"createdAt": {"$gte": start}})
    new_users = await users_coll.count_documents({"createdAt": {"$gte": start}})
    new_farmers = await users_coll.count_documents({"role": "farmer", "createdAt": {"$gte": start}})

    top_products = await orders_coll.aggregate([
        {"$match": {"createdAt": {"$gte": start}}},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.productId", "totalSold": {"$sum": "$items.quantity"}, "revenue": {"$sum": {"$multiply": ["$items.price", "$items.quantity"]}}}},
        {"$sort": {"totalSold": -1}},
        {"$limit": 10}
    ]).to_list(100)

    return {
        "period": period,
        "totalRevenue": total_revenue,
        "totalOrders": total_orders,
        "newUsers": new_users,
        "newFarmers": new_farmers,
        "topProducts": [
            {"productId": str(p["_id"]), "totalSold": p["totalSold"], "revenue": p["revenue"]}
            for p in top_products
        ]
    }

@router.post("/complaints/{complaint_id}/respond")
async def respond_to_complaint(
    complaint_id: str,
    data: ComplaintUpdate,
    current_user: dict = Depends(require_role("admin"))
):
    collection = MongoDB.get_collection("complaints")
    update = {}
    if data.status:
        update["status"] = data.status.value
    if data.adminResponse:
        update["adminResponse"] = data.adminResponse
    if data.status and data.status.value == "resolved":
        update["resolvedAt"] = datetime.utcnow()
    update["updatedAt"] = datetime.utcnow()
    result = await collection.find_one_and_update(
        {"_id": ObjectId(complaint_id)},
        {"$set": update},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "Complaint not found")
    return {"message": "Response submitted", "complaintId": complaint_id}
