@router.get("/me/packing-tasks", response_model=dict)
async def get_packing_tasks(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access packing tasks")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse: raise HTTPException(status_code=404, detail="Warehouse not found")
    # Self-heal legacy warehouse orders that were stored before the packing task
    # was created (or whose old incoming rows lacked packingRequired=True).
    # The packing service itself validates warehouse fulfillment and usable stock.
    try:
        stored_rows = await incoming_stock_repository.find_many({
            "warehouseId": warehouse["_id"],
            "status": "stored",
            "deletedAt": None,
        }, skip=0, limit=1000)
        order_ids = {
            str(row.get("orderId"))
            for row in stored_rows
            if row.get("orderId")
            and str(row.get("sourceMode") or "").lower() not in ("farmer_fulfillment", "farmer_fulfillment_transfer")
            and row.get("packingRequired") is not False
        }
        for order_id in order_ids:
            if not ObjectId.is_valid(order_id):
                continue
            order = await order_repository.get_by_id(order_id)
            if not order or str(order.get("fulfillmentMethod") or "").lower() != "warehouse":
                continue
            await WarehouseService.ensure_order_packing_task(order_id, str(warehouse["_id"]))
    except Exception:
        logger.exception("Failed to reconcile stored warehouse orders into packing tasks")

    tasks = await warehouse_packing_repository.get_by_warehouse(str(warehouse["_id"]), status)

    def make_json_safe(value: Any) -> Any:
        """Recursively convert MongoDB values into JSON-serializable values."""
        if isinstance(value, ObjectId):
            return str(value)
        if isinstance(value, dict):
            return {str(key): make_json_safe(child) for key, child in value.items()}
        if isinstance(value, (list, tuple)):
            return [make_json_safe(child) for child in value]
        if isinstance(value, datetime):
            return value.isoformat()
        return value

    for task in tasks:
        task = make_json_safe(task)
        task["id"] = str(task.get("_id") or task.get("id") or "")
        for key in ("warehouseId","orderId","farmerId","productId","variantId","batchId"):
            if task.get(key) is not None: task[key] = str(task[key])
        if task.get("orderId"):
            order = await order_repository.get_by_id(str(task["orderId"]))
            if order:
                task["orderNumber"] = order.get("orderNumber")
                task["deliveryAddress"] = order.get("deliveryAddress") or {}
                task["items"] = [
                    {
                        "productId": str(item.get("productId")),
                        "productName": item.get("productName") or "Product",
                        "quantity": float(item.get("quantity", 0) or 0),
                        "unitPrice": item.get("unitPrice", 0),
                    }
                    for item in (order.get("items") or [])
                ]
                customer = await UserService.get_user_by_id(str(order.get("customerId"))) if order.get("customerId") else None
                task["customer"] = {
                    "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip() if customer else "Customer",
                    "phone": customer.get("phone") if customer else None,
                }
    return make_json_safe({"success": True, "data": {"tasks": tasks}})
