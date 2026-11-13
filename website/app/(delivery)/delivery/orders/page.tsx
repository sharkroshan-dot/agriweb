"use client";

import { useState } from "react";
import { MapPinned, PackageCheck } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { DeliveryOrderMapPage } from "../order-map/page";
import { DeliveryDeliveriesPage } from "../deliveries/page";

type WorkspaceTab = "map" | "deliveries";

export default function DeliveryOrdersWorkspacePage() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("map");

  return (
    <div className="space-y-5">
      <div className="delivery-page-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Customer delivery workspace</p>
          <h1 className="delivery-page-title text-3xl font-semibold tracking-tight">Order Map &amp; My Deliveries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find nearby orders, manage assigned deliveries, and complete every delivery step from one workspace.
          </p>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Customer delivery workspace">
            <Button
              type="button"
              role="tab"
              aria-selected={activeTab === "map"}
              variant={activeTab === "map" ? "default" : "outline"}
              className={activeTab === "map" ? "bg-emerald-700 hover:bg-emerald-800" : ""}
              onClick={() => setActiveTab("map")}
            >
              <MapPinned className="mr-2 h-4 w-4" />
              Order Map &amp; Nearby Orders
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={activeTab === "deliveries"}
              variant={activeTab === "deliveries" ? "default" : "outline"}
              className={activeTab === "deliveries" ? "bg-emerald-700 hover:bg-emerald-800" : ""}
              onClick={() => setActiveTab("deliveries")}
            >
              <PackageCheck className="mr-2 h-4 w-4" />
              My Deliveries &amp; Actions
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Switch views without leaving the combined workspace. Existing delivery actions are retained.
          </p>
        </CardContent>
      </Card>

      <section
        role="tabpanel"
        aria-label="Order map and nearby orders"
        hidden={activeTab !== "map"}
        className="min-w-0"
      >
        <DeliveryOrderMapPage />
      </section>

      <section
        role="tabpanel"
        aria-label="My deliveries and delivery actions"
        hidden={activeTab !== "deliveries"}
        className="min-w-0"
      >
        <DeliveryDeliveriesPage />
      </section>
    </div>
  );
}
