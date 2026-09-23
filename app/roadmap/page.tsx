import Link from "next/link";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const phases = [
  {
    name: "MVP",
    window: "Launch first",
    accent: "bg-emerald-600",
    items: [
      "Farmer registration and login",
      "Role-based dashboards for farmers, customers, warehouse, delivery, and admin",
      "Product listing, inventory, and category management",
      "Customer browse, search, cart, and checkout",
      "UPI/payment integration and order tracking",
      "Basic admin moderation and reports",
    ],
  },
  {
    name: "Phase 2",
    window: "Growth",
    accent: "bg-sky-600",
    items: [
      "Wishlist, reviews, and customer address book",
      "Delivery assignment and live tracking",
      "Warehouse incoming/outgoing stock workflows",
      "Notifications and OTP flows",
      "Coupons, wallet, and refunds",
      "Analytics for sales, users, and operations",
    ],
  },
  {
    name: "Phase 3",
    window: "AI layer",
    accent: "bg-violet-600",
    items: [
      "Price prediction and demand forecasting",
      "Product recommendations",
      "Route optimization",
      "Crop recommendation assistant",
      "Disease detection from images",
      "Multilingual AI chatbot and voice assistant",
    ],
  },
];

const futureFeatures = [
  "Live auction for produce",
  "Subscription vegetable baskets",
  "Farm visit booking",
  "Cold storage booking",
  "Equipment and fertilizer marketplace",
  "Crop insurance and loan workflows",
  "B2B wholesale orders",
  "Weather alerts and government scheme information",
];

export default function RoadmapPage() {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-80 bg-gradient-to-b from-emerald-50 via-slate-50 to-transparent" />
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-6 py-16 lg:px-8 lg:py-24">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div className="space-y-5">
            <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
              Full product roadmap
            </div>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                From MVP to AI-powered agri commerce, one build phase at a time.
              </h1>
              <p className="max-w-2xl text-lg text-slate-600">
                This roadmap turns the startup idea into a realistic delivery plan for the current repo.
                We start with the commerce core, then layer in logistics, analytics, and AI.
              </p>
            </div>
          </div>
          <Card className="border-emerald-100 bg-white/90 shadow-lg shadow-emerald-100/40">
            <CardHeader>
              <CardTitle>Build order</CardTitle>
              <CardDescription>What we should ship first to get real users and real data.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">1. Commerce core</p>
                <p className="mt-1 text-sm text-slate-600">Auth, products, cart, checkout, orders, and admin review.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">2. Fulfillment</p>
                <p className="mt-1 text-sm text-slate-600">Delivery, warehouse, notifications, and payment workflows.</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">3. Intelligence</p>
                <p className="mt-1 text-sm text-slate-600">Prediction, recommendations, route optimization, and AI support.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          {phases.map((phase) => (
            <Card key={phase.name} className="h-full border-slate-200">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className={`h-3 w-3 rounded-full ${phase.accent}`} />
                  <CardTitle>{phase.name}</CardTitle>
                </div>
                <CardDescription>{phase.window}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {phase.items.map((item) => (
                  <div key={item} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                    {item}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Recommended MVP</CardTitle>
              <CardDescription>What we should focus on before adding advanced features.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-700">
              <p>• Farmer registration and verification</p>
              <p>• Product listing with photos</p>
              <p>• Customer browsing and search</p>
              <p>• Shopping cart and checkout</p>
              <p>• UPI payments</p>
              <p>• Order tracking</p>
              <p>• Basic admin dashboard</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Future expansion</CardTitle>
              <CardDescription>The broader feature set from your startup brief.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {futureFeatures.map((item) => (
                <div key={item} className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="flex flex-col items-start justify-between gap-4 rounded-3xl bg-slate-950 px-6 py-8 text-white sm:flex-row sm:items-center">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Next step</p>
            <h2 className="mt-2 text-2xl font-semibold">Start with the MVP build slice.</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              That means auth, product listing, cart, checkout, and order tracking first.
            </p>
          </div>
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/register">Get started</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back home</Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
