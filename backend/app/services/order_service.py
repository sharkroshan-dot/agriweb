                    updated = await OrderService.update_order_status(
                        oid, farmer_id, "farmer",
                        OrderStatusUpdate(status=OrderStatus.PROCESSING)
                    )
                elif action in ("farmer_fulfillment", "warehouse_fulfillment") and status == OrderStatus.PROCESSING.value:
                    method = FulfillmentMethod.FARM_DIRECT if action == "farmer_fulfillment" else FulfillmentMethod.WAREHOUSE
                    updated = await OrderService.set_fulfillment_route(oid, farmer_id, "farmer", method)
                elif action == "pack" and route == FulfillmentMethod.FARM_DIRECT.value and status == OrderStatus.PROCESSING.value and stage == FulfillmentStage.PENDING.value:
                    # Actual packing quantities must be entered through the final
                    # packing endpoint; never auto-claim the ordered quantity.
                    skipped.append({"orderId": oid, "orderNumber": order.get("orderNumber"), "reason": "Actual packed quantities require the packing form"})
                elif action == "dispatch" and route == FulfillmentMethod.FARM_DIRECT.value and status == OrderStatus.PROCESSING.value and stage == FulfillmentStage.PACKED.value:
                    updated = await OrderService.update_fulfillment_stage(oid, farmer_id, "farmer", FulfillmentStage.DISPATCHED)
                if updated:
                    processed.append({"orderId": oid, "orderNumber": order.get("orderNumber")})
                else:
                    skipped.append({"orderId": oid, "orderNumber": order.get("orderNumber"), "reason": "Not eligible for this step"})