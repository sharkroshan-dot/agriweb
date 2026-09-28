"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CheckCircle2, Circle, Clock3, Workflow } from "lucide-react";

type Step = { label: string; href: string; description: string };
type Role = "farmer" | "customer" | "delivery" | "warehouse" | "business" | "admin";

const FLOWS: Record<Role, Step[]> = {
  farmer: [
    { label: "Farm Setup", href: "/farmer/dashboard", description: "Complete farm profile and operating details." },
    { label: "Crop Planning", href: "/farmer/harvest-planner", description: "Plan crops, yield and harvest window." },
    { label: "Growing", href: "/farmer/harvest-planner", description: "Track the crop until it is ready." },
    { label: "Pre-orders", href: "/farmer/harvest-planner", description: "Open customer pre-orders when ready." },
    { label: "Harvest", href: "/farmer/harvest-planner", description: "Record actual quantity and final selling rate." },
    { label: "Batch", href: "/farmer/batches", description: "Create the traceable harvest lot." },
    { label: "Quality", href: "/farmer/quality", description: "Run AI-assisted inspection and approve/reject." },
    { label: "Product", href: "/farmer/products", description: "Publish the approved produce." },
    { label: "Inventory", href: "/farmer/restock", description: "Monitor available and reserved stock." },
    { label: "Orders", href: "/farmer/orders", description: "Confirm and prepare customer orders." },
    { label: "Delivery", href: "/farmer/order-map", description: "Assign, route and complete delivery." },
    { label: "Earnings", href: "/farmer/earnings", description: "Review completed sales and settlements." },
  ],
  customer: [
    { label: "Browse", href: "/customer/products", description: "Find produce and inspect availability." },
    { label: "Product", href: "/customer/products", description: "Choose quantity and purchase or preorder." },
    { label: "Address", href: "/customer/profile/addresses", description: "Select or add a delivery address." },
    { label: "Delivery Fee", href: "/customer/checkout", description: "See delivery and platform charges before purchase." },
    { label: "Checkout", href: "/customer/checkout", description: "Review the final total and payment method." },
    { label: "Payment", href: "/customer/orders", description: "Complete online payment or choose COD." },
    { label: "Order", href: "/customer/orders", description: "Track order status and details." },
    { label: "Delivery", href: "/customer/orders", description: "Follow dispatch and delivery progress." },
    { label: "Review", href: "/customer/orders", description: "Review the completed order." },
  ],
  delivery: [
    { label: "Availability", href: "/delivery/dashboard", description: "Set your availability and service area." },
    { label: "Assignment", href: "/delivery/dashboard", description: "Review available delivery jobs." },
    { label: "Accept", href: "/delivery/dashboard", description: "Accept a job and view its order details." },
    { label: "Pickup", href: "/delivery/deliveries", description: "Verify the pickup and package." },
    { label: "Dispatch", href: "/delivery/route", description: "Start the route and update transit status." },
    { label: "Delivery", href: "/delivery/deliveries", description: "Complete delivery with proof." },
    { label: "Earnings", href: "/delivery/earnings", description: "Review completed delivery earnings." },
  ],
  warehouse: [
    { label: "Incoming Stock", href: "/warehouse/stock", description: "Receive incoming produce." },
    { label: "Batch Verification", href: "/warehouse/incoming", description: "Verify batch and traceability data." },
    { label: "Quality", href: "/warehouse/incoming", description: "Inspect quality before storage." },
    { label: "Storage", href: "/warehouse/stock", description: "Place stock in the appropriate storage area." },
    { label: "Inventory", href: "/warehouse/stock", description: "Track available warehouse stock." },
    { label: "Pick & Pack", href: "/warehouse/stock", description: "Prepare stock for dispatch." },
    { label: "Dispatch", href: "/warehouse/stock", description: "Release the shipment to delivery." },
  ],
  business: [
    { label: "Business Setup", href: "/business/dashboard", description: "Complete business profile." },
    { label: "Category", href: "/business/rfqs/new", description: "Select a marketplace category." },
    { label: "RFQ", href: "/business/rfqs/new", description: "Create the bulk request." },
    { label: "Farmer Quotes", href: "/business/quotes", description: "Review submitted farmer offers." },
    { label: "Select Quote", href: "/business/quotes", description: "Choose an offer and continue." },
    { label: "Contract", href: "/business/contracts", description: "Manage the agreed terms." },
    { label: "B2B Order", href: "/business/orders", description: "Track the resulting order." },
    { label: "Payment", href: "/business/orders", description: "Complete the required payment." },
    { label: "Fulfillment", href: "/business/orders", description: "Track preparation and dispatch." },
    { label: "Delivery", href: "/business/orders", description: "Track delivery to completion." },
  ],
  admin: [
    { label: "Overview", href: "/admin/dashboard", description: "Monitor platform activity." },
    { label: "Users", href: "/admin/users", description: "Manage accounts and roles." },
    { label: "Farmers", href: "/admin/farmers", description: "Review farmer activity." },
    { label: "Products", href: "/admin/products", description: "Review marketplace products." },
    { label: "Harvests & Batches", href: "/admin/dashboard", description: "Inspect traceability." },
    { label: "Quality", href: "/admin/dashboard", description: "Review quality inspections." },
    { label: "Inventory", href: "/admin/inventory", description: "Monitor stock." },
    { label: "Orders", href: "/admin/orders", description: "Monitor fulfillment." },
    { label: "Payments", href: "/admin/payments", description: "Review payment activity." },
    { label: "Delivery", href: "/admin/delivery", description: "Monitor delivery operations." },
    { label: "Analytics", href: "/admin/analytics", description: "Review platform insights." },
  ],
};

function isDone(pathname: string, index: number, steps: Step[]) {
  const exact = steps.findIndex((s) => pathname === s.href || pathname.startsWith(s.href + "/"));
  return exact >= 0 && index < exact;
}

export function WorkflowGuide({ role }: { role: Role }) {
  const pathname = usePathname();
  const steps = FLOWS[role];
  const current = steps.findIndex((s) => pathname === s.href || pathname.startsWith(s.href + "/"));
  const currentIndex = current >= 0 ? current : 0;
  const next = steps[currentIndex + 1];

  return (
    <section className="mb-5 rounded-2xl border border-emerald-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <Workflow className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Your workflow</p>
            <p className="text-xs text-slate-500">Follow the next step — you do not need to know the page structure.</p>
          </div>
        </div>
        {next && (
          <Link href={next.href} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            Continue: {next.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
      <div className="overflow-x-auto p-4">
        <div className="flex min-w-max items-start gap-2">
          {steps.map((step, index) => {
            const active = index === currentIndex;
            const done = isDone(pathname, index, steps);
            return (
              <div key={step.label} className="flex items-center gap-2">
                <Link href={step.href} title={step.description} className={`group flex w-28 flex-col gap-1 rounded-xl border p-2.5 text-left transition ${active ? "border-emerald-300 bg-emerald-50" : done ? "border-emerald-100 bg-emerald-50/40" : "border-slate-200 bg-slate-50 hover:border-emerald-200"}`}>
                  {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : active ? <Clock3 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-400" />}
                  <span className={`text-xs font-semibold ${active ? "text-emerald-800" : "text-slate-700"}`}>{step.label}</span>
                  <span className="line-clamp-2 text-[10px] text-slate-500">{step.description}</span>
                </Link>
                {index < steps.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
