"use client";

import { MapPinned, PackageCheck } from "lucide-react";
import DeliveryOrderMapPage from "../order-map/page";
import DeliveryDeliveriesPage from "../deliveries/page";

export default function DeliveryOrdersWorkspacePage() {
  return (
    <div className="space-y-6">
      <div className="delivery-page-header">
        <p className="text-sm font-medium text-primary">Customer delivery workspace</p>
        <h1 className="delivery-page-title text-3xl font-semibold tracking-tight">Order Map &amp; My Deliveries</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Discover nearby delivery orders and manage every assigned delivery from one page.
        </p>
      </div>

      <section aria-labelledby="combined-order-map-heading" className="space-y-4">
        <div className="flex items-center gap-2 border-b border-emerald-100 pb-3">
          <MapPinned className="h-5 w-5 text-emerald-700" />
          <div>
            <h2 id="combined-order-map-heading" className="text-lg font-semibold text-slate-900">Order Map &amp; Nearby Orders</h2>
            <p className="text-sm text-muted-foreground">Live GPS, radius filtering, map markers, route preview and order acceptance.</p>
          </div>
        </div>
        <DeliveryOrderMapPage />
      </section>

      <section aria-labelledby="combined-my-deliveries-heading" className="space-y-4 border-t-4 border-slate-100 pt-6">
        <div className="flex items-center gap-2 border-b border-emerald-100 pb-3">
          <PackageCheck className="h-5 w-5 text-emerald-700" />
          <div>
            <h2 id="combined-my-deliveries-heading" className="text-lg font-semibold text-slate-900">My Deliveries &amp; Delivery Operations</h2>
            <p className="text-sm text-muted-foreground">Assigned orders, pickup, dispatch, OTP/QR verification, proof of delivery and delivery status.</p>
          </div>
        </div>
        <DeliveryDeliveriesPage />
      </section>
    </div>
  );
}
