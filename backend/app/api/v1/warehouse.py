                    "receivedAtConsolidation": leg.get("receivedAtConsolidation").isoformat() if isinstance(leg.get("receivedAtConsolidation"), datetime) else None,
                }
                for leg in consolidation_legs
            ],
            "totalConsolidationLegCount": len(consolidation_legs),
            "inTransitLegCount": sum(1 for leg in consolidation_legs if str(leg.get("status") or "") == "in_transit"),
            "receivedConsolidationLegCount": len(received_consolidation_legs),
            "canDispatchToConsolidation": any(str(a.get("warehouseId")) == str(warehouse["_id"]) for a in (order.get("warehouseAllocations") or [])),
            "isConsolidationWarehouse": str(order.get("consolidationWarehouseId") or "") == str(warehouse["_id"]),
            "deliveryPartnerJobId": order.get("deliveryPartnerJobId"),
        })
    # Event/business bulk orders are stored in bulk_requests + event_fulfillments,
    # not the standard orders collection. Include them in this same operational
    # screen so warehouse staff can track every farmer/product portion.
    bulk_requests = MongoDB.get_collection("bulk_requests")
    event_fulfillments_collection = MongoDB.get_collection("event_fulfillments")
    event_requests = await bulk_requests.find({
        "deletedAt": None,
        "$or": [
            {"eventWarehouseId": {"$in": warehouse_refs}},
            {"eventLocalHubId": {"$in": warehouse_refs}},
            {"eventSourceWarehouseIds": {"$in": warehouse_refs}},
        ],
        "eventSourcingStatus": {"$nin": ["cancelled"]},
        "status": {"$nin": ["cancelled"]},
    }).sort("updatedAt", -1).limit(200).to_list(length=200)
    for request in event_requests:
        event_warehouse_id = str(request.get("eventWarehouseId") or "")
        local_hub_id = str(request.get("eventLocalHubId") or "")
        is_event_consolidation_warehouse = event_warehouse_id == warehouse_id
        is_event_local_hub = local_hub_id == warehouse_id
        event_source_warehouse_ids = {str(value) for value in (request.get("eventSourceWarehouseIds") or [])}
        is_event_source_warehouse = warehouse_id in event_source_warehouse_ids
        fulfillments = await event_fulfillments_collection.find({
            "requestId": request["_id"], "deletedAt": None,
        }).to_list(length=500)
        if not fulfillments:
            continue

        # This screen is exclusively for true multi-warehouse consolidation.
        # Event requests are also queried when this warehouse is the event
        # destination or local hub, so those query matches alone must not make
        # a single-source order appear here.
        fulfillment_source_ids = {
            str(row.get("sourceWarehouseId") or row.get("warehouseId") or "").strip()
            for row in fulfillments
            if str(row.get("sourceWarehouseId") or row.get("warehouseId") or "").strip()
        }
        declared_source_ids = {
            str(value).strip()
            for value in (request.get("eventSourceWarehouseIds") or [])
            if str(value).strip()
        }
        distinct_source_warehouse_ids = fulfillment_source_ids or declared_source_ids
        if len(distinct_source_warehouse_ids) < 2:
            continue

        incoming_rows = await incoming_stock_repository.find_many({
            "eventRequestId": request["_id"], "deletedAt": None,
        }, skip=0, limit=1000)
        incoming_by_fulfillment = {
            str(row.get("eventFulfillmentId")): row
            for row in incoming_rows if row.get("eventFulfillmentId")
        }
        portions = []
        stored_count = 0
        for fulfillment in fulfillments:
            fid = str(fulfillment.get("_id") or "")
            incoming_row = incoming_by_fulfillment.get(fid) or {}
            fulfillment_status = str(fulfillment.get("status") or "pending_farmer_confirmation")
            actual_received = incoming_row.get("quantityReceived")
            if actual_received is None:
                actual_received = incoming_row.get("receivedQuantity")
            if actual_received is None:
                actual_received = incoming_row.get("actualQuantityReceived")
            actual_received = float(actual_received or 0)
            required_qty = float(fulfillment.get("allocatedQuantityKg") or 0)
            quality_status = str(incoming_row.get("qualityCheck") or "pending")
            source_warehouse_id = str(fulfillment.get("sourceWarehouseId") or fulfillment.get("warehouseId") or event_warehouse_id)
            source_stored = fulfillment_status == "stored" and str(incoming_row.get("status") or "").lower() == "stored" and quality_status.lower() == "passed" and actual_received + 1e-9 >= required_qty
            consolidation_received = source_warehouse_id == event_warehouse_id or str(fulfillment.get("consolidationStatus") or "") == "received"
            is_stored = source_stored and consolidation_received
            if is_stored:
                stored_count += 1
            transfer_job_id = str(fulfillment.get("consolidationTransferJobId") or "")
            transfer_job = await delivery_job_repository.get_by_id(transfer_job_id) if ObjectId.is_valid(transfer_job_id) else None
            transfer_progress_status = str((transfer_job or {}).get("eventProgressStatus") or "")
            farmer = await farmer_repository.find_one({"userId": fulfillment.get("farmerId")}) if fulfillment.get("farmerId") else None
            portion_status = (
                "stored_at_consolidation" if is_stored else
                "stored_at_source_warehouse" if source_stored else
                "warehouse_received" if fulfillment_status == "warehouse_received" else
                "quality_check" if str(incoming_row.get("status") or "").lower() in ("quality_check", "quality_check_pending") else
                "received_at_warehouse" if str(incoming_row.get("status") or "").lower() == "received" else
                "ready_for_collection" if fulfillment_status == "ready_for_collection" else