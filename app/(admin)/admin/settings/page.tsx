"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Brain, Globe, Loader2, RefreshCw, Save, Shield, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Switch } from "../../../components/ui/switch";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const emptyGeneral = {
  platformName: "",
  supportEmail: "",
  supportPhone: "",
  currency: "INR",
  timezone: "Asia/Kolkata",
};

const emptyFees = {
  commissionRate: 5,
  minimumOrderValue: 99,
  codEnabled: true,
  farmerBaseFee: 10,
  freeDeliveryRadiusKm: 5,
  farmerPerKmRate: 4,
  maxDeliveryRadiusKm: 20,
  partnerBaseFee: 15,
  partnerPerKmRate: 5,
  minimumDeliveryFee: 15,
  maxDeliveryFee: 0,
  freeDeliveryMinOrderAmount: 0,
  freeDeliveryMaxDistanceKm: 5,
  bulkBaseFee: 0,
  bulkPerKmRate: 0,
  bulkPerKgRate: 0,
  partnerDeliveryEarningRate: 100,
  useRoadDistance: true,
};

const emptyAi = {
  autoPricing: false,
  aiRecommendations: true,
  demandForecasting: true,
  cropAdvisory: true,
};

const emptyNotifications = {
  emailAlerts: true,
  smsAlerts: false,
  orderUpdates: true,
  securityAlerts: true,
};

const emptySecurity = {
  newUserVerification: true,
  maintenanceMode: false,
  twoFactorAdmins: true,
};

export default function AdminSettingsPage() {
  const [general, setGeneral] = useState(emptyGeneral);
  const [fees, setFees] = useState(emptyFees);
  const [ai, setAi] = useState(emptyAi);
  const [notifications, setNotifications] = useState(emptyNotifications);
  const [security, setSecurity] = useState(emptySecurity);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminSettings"],
    queryFn: () => api.get("/settings/platform"),
  });

  useEffect(() => {
    const saved = data?.data;
    if (!saved) {
      return;
    }
    if (saved.general) setGeneral((current) => ({ ...current, ...saved.general }));
    if (saved.fees) setFees((current) => ({ ...current, ...saved.fees }));
    if (saved.ai) setAi((current) => ({ ...current, ...saved.ai }));
    if (saved.notifications) setNotifications((current) => ({ ...current, ...saved.notifications }));
    if (saved.security) setSecurity((current) => ({ ...current, ...saved.security }));
  }, [data?.data]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setIsSaving(true);
      await api.put("/settings/platform", {
        general,
        fees,
        ai,
        notifications,
        security,
      });
      setLastSaved(new Date().toLocaleTimeString());
      toast.success("Platform settings saved");
      refetch();
    } catch (error) {
      toast.error("Failed to save platform settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="h-96 animate-pulse rounded-lg bg-muted" />
          <div className="h-96 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Platform settings</p>
          <h1 className="text-3xl font-semibold tracking-tight">Admin settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure platform defaults, fees, AI behavior, notifications, and access rules.</p>
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && <span className="text-xs text-muted-foreground">Saved at {lastSaved}</span>}
          <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <form className="grid gap-6 xl:grid-cols-2" onSubmit={handleSave}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" />General</CardTitle>
            <CardDescription>Core platform information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">Platform name</label>
              <Input value={general.platformName} onChange={(event) => setGeneral({ ...general, platformName: event.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Support email</label>
                <Input type="email" value={general.supportEmail} onChange={(event) => setGeneral({ ...general, supportEmail: event.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Support phone</label>
                <Input value={general.supportPhone} onChange={(event) => setGeneral({ ...general, supportPhone: event.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Currency</label>
                <Input value={general.currency} onChange={(event) => setGeneral({ ...general, currency: event.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Timezone</label>
                <Input value={general.timezone} onChange={(event) => setGeneral({ ...general, timezone: event.target.value })} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" />Platform fees</CardTitle>
            <CardDescription>Commission and delivery pricing rules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Commission rate (%)</label>
                <Input type="number" min="0" max="100" value={fees.commissionRate} onChange={(event) => setFees({ ...fees, commissionRate: Number(event.target.value) })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Minimum order value (₹)</label>
                <Input type="number" min="0" value={fees.minimumOrderValue} onChange={(event) => setFees({ ...fees, minimumOrderValue: Number(event.target.value) })} />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Delivery fees</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Farmer base fee (₹)</label>
                  <Input type="number" min="0" step="0.5" value={fees.farmerBaseFee} onChange={(event) => setFees({ ...fees, farmerBaseFee: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Free delivery radius (km)</label>
                  <Input type="number" min="0" step="0.5" value={fees.freeDeliveryRadiusKm} onChange={(event) => setFees({ ...fees, freeDeliveryRadiusKm: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Farmer fee / km (₹)</label>
                  <Input type="number" min="0" step="0.5" value={fees.farmerPerKmRate} onChange={(event) => setFees({ ...fees, farmerPerKmRate: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Max delivery radius (km)</label>
                  <Input type="number" min="0" step="0.5" value={fees.maxDeliveryRadiusKm} onChange={(event) => setFees({ ...fees, maxDeliveryRadiusKm: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Partner base fee (₹)</label>
                  <Input type="number" min="0" step="0.5" value={fees.partnerBaseFee} onChange={(event) => setFees({ ...fees, partnerBaseFee: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Partner fee / km (₹)</label>
                  <Input type="number" min="0" step="0.5" value={fees.partnerPerKmRate} onChange={(event) => setFees({ ...fees, partnerPerKmRate: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Minimum delivery fee (₹)</label>
                  <Input type="number" min="0" step="0.5" value={fees.minimumDeliveryFee} onChange={(event) => setFees({ ...fees, minimumDeliveryFee: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Max delivery fee cap (₹, 0 = no cap)</label>
                  <Input type="number" min="0" step="0.5" value={fees.maxDeliveryFee} onChange={(event) => setFees({ ...fees, maxDeliveryFee: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Free delivery order amount (₹, 0 = off)</label>
                  <Input type="number" min="0" step="0.5" value={fees.freeDeliveryMinOrderAmount} onChange={(event) => setFees({ ...fees, freeDeliveryMinOrderAmount: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Free delivery max distance (km)</label>
                  <Input type="number" min="0" step="0.5" value={fees.freeDeliveryMaxDistanceKm} onChange={(event) => setFees({ ...fees, freeDeliveryMaxDistanceKm: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Partner earning (% of delivery fee)</label>
                  <Input type="number" min="0" max="100" step="1" value={fees.partnerDeliveryEarningRate} onChange={(event) => setFees({ ...fees, partnerDeliveryEarningRate: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Bulk base fee (₹, 0 = off)</label>
                  <Input type="number" min="0" step="0.5" value={fees.bulkBaseFee} onChange={(event) => setFees({ ...fees, bulkBaseFee: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Bulk fee / km (₹)</label>
                  <Input type="number" min="0" step="0.5" value={fees.bulkPerKmRate} onChange={(event) => setFees({ ...fees, bulkPerKmRate: Number(event.target.value) })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Bulk fee / kg (₹)</label>
                  <Input type="number" min="0" step="0.5" value={fees.bulkPerKgRate} onChange={(event) => setFees({ ...fees, bulkPerKgRate: Number(event.target.value) })} />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Delivery fee = base + distance (per km), floored at the minimum. Free delivery kicks in above the order amount within the max distance (subsidy is tracked). Bulk = base + per km + per kg. Overrides apply platform-wide.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Use road distance (OSRM)</span>
              <Switch checked={fees.useRoadDistance} onCheckedChange={(on) => setFees({ ...fees, useRoadDistance: on })} aria-label="Use road distance for delivery fees" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm font-medium">Cash on delivery</span>
              <Switch checked={fees.codEnabled} onCheckedChange={(on) => setFees({ ...fees, codEnabled: on })} aria-label="Cash on delivery" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" />AI & analytics</CardTitle>
            <CardDescription>Control intelligent platform features.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "AI demand forecasting", key: "demandForecasting" as const, desc: "Predict stock demand from past orders" },
              { label: "AI product recommendations", key: "aiRecommendations" as const, desc: "Show personalized suggestions to customers" },
              { label: "AI crop advisory", key: "cropAdvisory" as const, desc: "Farming guidance for registered farmers" },
              { label: "Auto pricing adjustments", key: "autoPricing" as const, desc: "Let AI tune prices to demand" },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <span className="text-sm font-medium">{item.label}</span>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <Switch checked={ai[item.key]} onCheckedChange={(on) => setAi({ ...ai, [item.key]: on })} aria-label={item.label} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Security</CardTitle>
            <CardDescription>Access and authentication rules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Require new user verification", key: "newUserVerification" as const, desc: "Admins approve new accounts" },
              { label: "Two-factor for admins", key: "twoFactorAdmins" as const, desc: "Require 2FA for admin accounts" },
              { label: "Maintenance mode", key: "maintenanceMode" as const, desc: "Temporarily pause the platform" },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <span className="text-sm font-medium">{item.label}</span>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <Switch checked={security[item.key]} onCheckedChange={(on) => setSecurity({ ...security, [item.key]: on })} aria-label={item.label} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" />Notification & email</CardTitle>
            <CardDescription>System-wide communication settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Email alerts", key: "emailAlerts" as const, desc: "Send system alerts via email" },
              { label: "SMS alerts", key: "smsAlerts" as const, desc: "Send important alerts via SMS" },
              { label: "Order updates", key: "orderUpdates" as const, desc: "Notify users on order status changes" },
              { label: "Security alerts", key: "securityAlerts" as const, desc: "Alert on login and account events" },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <span className="text-sm font-medium">{item.label}</span>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <Switch checked={notifications[item.key]} onCheckedChange={(on) => setNotifications({ ...notifications, [item.key]: on })} aria-label={item.label} />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex items-end justify-end xl:col-span-2">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
