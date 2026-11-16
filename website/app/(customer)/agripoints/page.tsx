"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  BadgePercent,
  CheckCircle2,
  Coins,
  Gift,
  History,
  Info,
  Leaf,
  Loader2,
  ShoppingBasket,
  ShoppingCart,
  Sprout,
  Star,
  Trophy,
  Truck,
  Users,
} from "lucide-react";
import { api } from "../../lib/api/client";

const POINTS_PER_RUPEE = 100;

export default function AgriPointsPage() {
  const { data: pointsData, isLoading, isError } = useQuery({
    queryKey: ["loyalty", "me"],
    queryFn: () => api.get("/loyalty/me"),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const d = pointsData?.data ?? {};
  const rules = d.rules ?? {};
  const transactions = Array.isArray(d.transactions) ? d.transactions : [];
  const balance = Number(d.balance ?? 0);
  const lifetimeEarned = Number(d.lifetimeEarned ?? 0);
  const totalPointsUsed = Number(
    d.lifetimeSpent ??
      transactions.reduce(
        (sum: number, txn: any) =>
          sum + Math.max(0, -Number(txn.points ?? 0)),
        0,
      ),
  );
  const equivalentValue = balance / POINTS_PER_RUPEE;
  const rupeesPerHundred = 100;
  const nearbyBonus = Number(rules.bonusNearby ?? 5);
  const communityBonus = Number(rules.bonusCommunity ?? 20);

  const formatRupees = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const formatDateTime = (value: string) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  };

  return (
    <main className="min-w-0 space-y-5 pb-8">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="font-medium text-blue-700 hover:underline">
          Home
        </Link>
        <span aria-hidden="true">›</span>
        <span className="font-semibold text-slate-800">AgriPoints</span>
      </div>

      <section className="relative isolate overflow-hidden rounded-2xl border border-sky-100 bg-[linear-gradient(105deg,#ffffff_0%,#f0fdf4_42%,#e0f2fe_100%)] px-5 py-5 shadow-sm sm:px-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-[58%] opacity-80" aria-hidden="true">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#f0fdf4_0%,rgba(220,252,231,.45)_35%,rgba(186,230,253,.15)_100%)]" />
          <div className="absolute bottom-0 right-0 h-16 w-full rounded-tl-[100%] bg-gradient-to-t from-lime-300/60 to-emerald-100/10" />
          <div className="absolute bottom-0 right-8 h-12 w-3/4 rounded-tl-[100%] bg-gradient-to-t from-green-500/35 to-transparent" />
          <div className="absolute right-8 top-3 text-emerald-600/50"><Sprout className="h-20 w-20" /></div>
          <div className="absolute right-28 top-8 text-lime-600/40"><Leaf className="h-12 w-12" /></div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-4 ring-white">
            <Star className="h-8 w-8 fill-lime-300 stroke-emerald-700" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
              My AgriPoints
            </h1>
            <p className="mt-1 max-w-3xl text-sm font-medium text-slate-700 sm:text-base">
              Earn points on your purchases and use them at checkout to get instant discounts on your orders.
            </p>
          </div>
        </div>
      </section>

      {isError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          We couldn’t refresh your AgriPoints right now. The values below may be unavailable; please try again shortly.
        </div>
      )}

      <section aria-label="AgriPoints summary" className="grid gap-4 xl:grid-cols-[1.45fr_1fr_1fr]">
        <div className="flex min-h-[116px] items-center rounded-2xl bg-gradient-to-r from-emerald-700 via-emerald-700 to-green-800 p-5 text-white shadow-md shadow-emerald-900/10">
          <div className="flex w-1/2 items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <Coins className="h-10 w-10 text-amber-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-100">Available Points</p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums">{balance.toLocaleString("en-IN")} pts</p>
            </div>
          </div>
          <div className="mx-4 h-16 w-px bg-white/40" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-100">
              Equivalent Value
              <span title="100 AgriPoints = ₹1 discount">
                <Info className="h-4 w-4" />
              </span>
            </p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums">{formatRupees(equivalentValue)}</p>
          </div>
        </div>

        <SummaryCard
          icon={<Trophy className="h-10 w-10 text-amber-500" />}
          label="Total Points Earned"
          value={lifetimeEarned}
        />
        <SummaryCard
          icon={<Gift className="h-10 w-10 text-emerald-600" />}
          label="Total Points Used"
          value={totalPointsUsed}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Leaf className="h-7 w-7 fill-emerald-500 text-emerald-700" />
            <h2 className="text-xl font-extrabold text-slate-950">How to Earn AgriPoints</h2>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-emerald-200 overflow-hidden rounded-xl border border-emerald-100 bg-white/90 sm:grid-cols-4 sm:divide-y-0">
            <EarnMethod icon={<ShoppingCart />} title="Shop & Earn" detail={`₹${rupeesPerHundred} spent → 1 point`} />
            <EarnMethod icon={<Truck />} title="Nearby Delivery" detail={`→ +${nearbyBonus} points`} />
            <EarnMethod icon={<Users />} title="Community Delivery" detail={`→ +${communityBonus} points`} />
            <EarnMethod icon={<Star />} title="Special Campaigns" detail="Exciting bonus points" accent />
          </div>
        </div>

        <div className="flex flex-row items-center gap-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-100/60 p-5 shadow-sm">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
            <ShoppingBasket className="h-10 w-10" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold text-slate-950">Use AgriPoints at Checkout</h2>
            <p className="mt-1 text-sm leading-5 text-slate-700">
              Apply your available points during checkout to get an instant discount on your order.
            </p>
            <Link
              href="/marketplace"
              className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-full border-2 border-emerald-700 bg-white px-6 text-sm font-bold text-emerald-800 transition hover:bg-emerald-700 hover:text-white"
            >
              <ShoppingCart className="h-4 w-4" />
              Shop Now
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
            <h2 className="flex items-center gap-2 text-xl font-extrabold text-slate-950">
              <History className="h-6 w-6 text-slate-700" />
              Points History
            </h2>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">
              All Activities
            </span>
          </div>
          {transactions.length === 0 ? (
            <div className="mx-4 mb-4 rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              No points activity yet. Complete eligible orders to start earning AgriPoints.
            </div>
          ) : (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[700px] border-collapse text-left text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-800">
                    <th className="rounded-l-lg px-3 py-2 font-bold">Date &amp; Time</th>
                    <th className="px-3 py-2 font-bold">Activity</th>
                    <th className="px-3 py-2 font-bold">Order ID</th>
                    <th className="px-3 py-2 text-right font-bold">Points</th>
                    <th className="px-3 py-2 text-right font-bold">Value (₹)</th>
                    <th className="rounded-r-lg px-3 py-2 text-center font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn: any, index: number) => {
                    const points = Number(txn.points ?? 0);
                    const used = points < 0;
                    return (
                      <tr key={txn.id ?? txn._id ?? `${txn.createdAt ?? "txn"}-${index}`} className="border-b border-slate-100 last:border-0">
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDateTime(txn.createdAt)}</td>
                        <td className="px-3 py-3 font-medium text-slate-800">{txn.description || txn.reason || (used ? "Used at Checkout (Discount)" : "Order Purchase")}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-600">{txn.orderId || txn.referenceId || "—"}</td>
                        <td className={`whitespace-nowrap px-3 py-3 text-right font-extrabold ${used ? "text-red-600" : "text-emerald-700"}`}>
                          {used ? "" : "+"}{points.toLocaleString("en-IN")} pts
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-slate-700">{formatRupees(Math.abs(points) / POINTS_PER_RUPEE)}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${used ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-800"}`}>
                            {used ? "Used" : "Earned"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-xl font-extrabold text-blue-950">
            <Info className="h-7 w-7 text-blue-600" />
            Key Rules
          </h2>
          <ul className="space-y-2 rounded-xl bg-white/90 p-4 text-sm text-slate-800">
            <Rule>₹100 spent = 1 AgriPoint (configurable by admin).</Rule>
            <Rule>Points can be used as a discount at checkout.</Rule>
            <Rule>Example: 100 points = ₹1 discount.</Rule>
            <Rule>Points are credited after order completion.</Rule>
            <Rule>Points may be reversed if the order is cancelled or refunded.</Rule>
          </ul>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.8fr_1fr]">
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-xl font-extrabold text-emerald-950">
            <Sprout className="h-6 w-6 text-emerald-700" />
            End-to-End Flow – How It Works
          </h2>
          <div className="grid gap-3 rounded-xl bg-white/90 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <FlowStep number="1" icon={<ShoppingCart />} title="Place an Order" detail="Shop for products and complete an eligible order." />
            <FlowStep number="2" icon={<Gift />} title="Earn Points" detail="Get points automatically after order completion." />
            <FlowStep number="3" icon={<BadgePercent />} title="Use at Checkout" detail="Apply your available points for an instant discount." />
            <FlowStep number="4" icon={<CheckCircle2 />} title="Complete the Order" detail="Pay the reduced amount and place your order." />
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-xl font-extrabold text-amber-950">
            <Gift className="h-6 w-6 text-orange-600" />
            Benefits for Customers
          </h2>
          <ul className="space-y-2 rounded-xl bg-white/90 p-4 text-sm text-slate-800">
            <Rule>Earn rewards on every purchase.</Rule>
            <Rule>Get instant discounts on your orders.</Rule>
            <Rule>No wallet or top-up needed.</Rule>
            <Rule>Track all earned and used points in one place.</Rule>
          </ul>
        </div>
      </section>
    </main>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-h-[116px] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-50">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-700">{label}</p>
        <p className="mt-1 text-3xl font-extrabold tabular-nums text-slate-950">{value.toLocaleString("en-IN")} pts</p>
      </div>
    </div>
  );
}

function EarnMethod({
  icon,
  title,
  detail,
  accent = false,
}: {
  icon: React.ReactElement;
  title: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="flex min-h-[104px] flex-col items-center justify-center px-2 py-3 text-center">
      <span className={`mb-1 [&>svg]:h-8 [&>svg]:w-8 ${accent ? "text-amber-500" : "text-green-700"}`}>{icon}</span>
      <p className="text-sm font-extrabold text-slate-900">{title}</p>
      <p className="mt-1 text-xs font-semibold text-slate-700">{detail}</p>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 fill-green-600 text-white" />
      <span>{children}</span>
    </li>
  );
}

function FlowStep({
  number,
  icon,
  title,
  detail,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="relative flex flex-col items-center px-2 py-2 text-center after:absolute after:right-[-8px] after:top-1/2 after:hidden after:-translate-y-1/2 after:text-2xl after:font-bold after:text-green-700 after:content-['→'] last:after:hidden xl:after:block">
      <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 [&>svg]:h-7 [&>svg]:w-7">
        {icon}
      </div>
      <span className="absolute left-1/2 top-0 flex h-7 w-7 -translate-x-1/2 -translate-y-1/4 items-center justify-center rounded-full border-2 border-white bg-green-600 text-sm font-extrabold text-white">
        {number}
      </span>
      <p className="text-sm font-extrabold text-slate-950">{title}</p>
      <p className="mt-1 max-w-[190px] text-xs leading-4 text-slate-700">{detail}</p>
    </div>
  );
}
