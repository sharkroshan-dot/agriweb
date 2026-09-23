"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { Badge } from "../../../components/ui/badge";
import { Bot, CreditCard, Loader2, Package, Save, Shield, ShoppingBag, Store, Truck } from "lucide-react";
import { VerificationStatusCard } from "../../../components/security/verification-status";
import toast from "react-hot-toast";

type ToggleKeys =
  | "newOrderAlert"
  | "orderCancelled"
  | "paymentReceived"
  | "autoAcceptSmallOrders"
  | "lowStockAlerts"
  | "pricePrediction"
  | "demandForecast"
  | "weatherIntegration"
  | "smartRecommendations"
  | "dailyReport"
  | "weeklyReport"
  | "monthlyReport";

export default function FarmerSettingsPage() {
  const { data: session } = useSession();
  const userName = (session?.user as any)?.name || "Farmer";
  const userEmail = (session?.user as any)?.email || "";
  const accessToken = (session as any)?.accessToken;

  const [profile, setProfile] = useState({
    farmName: userName,
    ownerName: userName,
    phone: "",
    email: userEmail,
    city: "",
    weeklyPickupWindow: "Mon - Thu, 6 AM - 11 AM",
    farmAddress: "",
    pickupInstructions: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const [prefs, setPrefs] = useState<Record<string, any>>({
    product: { lowStockAlert: 10, criticalStock: 5, notificationMethod: "email" },
    orders: { orderTimeout: 30, maxOrdersPerDay: 50, minOrderValue: 100, deliveryRadius: 10 },
    delivery: {
      freeDeliveryRadiusKm: 5,
      baseFee: 10,
      perKmRate: 4,
      maxRadiusKm: 20,
      minOrderValue: 100,
      allowSelfDelivery: true,
      allowDeliveryPartners: true,
    },
    payouts: { bankAccount: "", accountHolder: "", accountNumber: "", ifsc: "", payoutFrequency: "weekly", minPayout: 500 },
    ai: {
      pricePrediction: true,
      demandForecast: true,
      weatherIntegration: true,
      smartRecommendations: true,
      dailyReport: true,
      weeklyReport: false,
      monthlyReport: false,
      reportFormat: "pdf",
    },
    alerts: {
      lowStockAlerts: true,
      autoAcceptSmallOrders: false,
      newOrderAlert: true,
      orderCancelled: true,
      paymentReceived: true,
    },
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const { data: profileData } = useQuery({
    queryKey: ["farmerProfile"],
    queryFn: () => api.get("/farmers/me/profile"),
    enabled: Boolean(accessToken),
  });

  const { data: settingsData } = useQuery({
    queryKey: ["farmerSettings"],
    queryFn: () => api.get("/settings/mine"),
    enabled: Boolean(accessToken),
  });

  useEffect(() => {
    if (profileData?.data) {
      const p = profileData.data;
      setProfile({
        farmName: p.farmName || userName,
        ownerName: p.ownerName || userName,
        phone: p.phone || "",
        email: p.email || userEmail,
        city: p.city || "",
        weeklyPickupWindow: p.weeklyPickupWindow || "Mon - Thu, 6 AM - 11 AM",
        farmAddress: p.farmAddress || "",
        pickupInstructions: p.pickupInstructions || "",
      });
    }
  }, [profileData?.data, userName, userEmail]);

  useEffect(() => {
    const saved = settingsData?.data;
    if (!saved) return;
    setPrefs((current) => ({
      product: { ...current.product, ...(saved.product || {}) },
      orders: { ...current.orders, ...(saved.orders || {}) },
      delivery: { ...current.delivery, ...(saved.delivery || {}) },
      payouts: { ...current.payouts, ...(saved.payouts || {}) },
      ai: { ...current.ai, ...(saved.ai || {}) },
      alerts: { ...current.alerts, ...(saved.alerts || {}) },
    }));
  }, [settingsData?.data]);

  const updateNested = (section: string, field: string, value: any) => {
    setPrefs((current) => ({ ...current, [section]: { ...current[section], [field]: value } }));
  };

  const toggle = (field: ToggleKeys) => {
    const section = (["pricePrediction", "demandForecast", "weatherIntegration", "smartRecommendations", "dailyReport", "weeklyReport", "monthlyReport"].includes(field))
      ? "ai"
      : (["newOrderAlert", "orderCancelled", "paymentReceived", "autoAcceptSmallOrders", "lowStockAlerts"].includes(field))
        ? "alerts"
        : "payouts";
    setPrefs((current) => ({ ...current, [section]: { ...current[section], [field]: !current[section][field] } }));
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const json = await api.put("/farmers/me/profile", profile);
      if (json.success) {
        toast.success("Farm profile saved");
      } else {
        toast.error(json.detail || "Failed to save");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePrefs = async () => {
    setSavingPrefs(true);
    try {
      await api.put("/settings/mine", prefs);
      setLastSaved(new Date().toLocaleTimeString());
      toast.success("Settings saved");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save settings");
    } finally {
      setSavingPrefs(false);
    }
  };

  const toggleRow = (label: string, key: ToggleKeys) => (
    <div key={key} className="flex items-center justify-between rounded-lg border p-3 text-sm font-medium">
      {label}
      <Switch checked={Boolean(prefs.alerts[key] ?? prefs.ai[key] ?? prefs.payouts[key])} onCheckedChange={() => toggle(key)} aria-label={`Toggle ${label}`} />
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Farmer preferences</p>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage farm profile, orders, payouts and AI tools.</p>
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && <span className="text-xs text-muted-foreground">Saved at {lastSaved}</span>}
          <Button size="sm" onClick={savePrefs} disabled={savingPrefs}>
            {savingPrefs ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Save all settings
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <VerificationStatusCard />

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" />Farm profile</CardTitle>
            <CardDescription>Visible to buyers and used across your farmer dashboard.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {[
              ["farmName", "Farm name"],
              ["ownerName", "Owner name"],
              ["phone", "Phone"],
              ["email", "Email"],
              ["city", "City"],
              ["weeklyPickupWindow", "Pickup window"],
              ["farmAddress", "Farm address"],
              ["pickupInstructions", "Pickup instructions"],
            ].map(([key, label]) => (
              <div key={key as string}>
                <label className="text-sm font-medium">{label}</label>
                <Input
                  className="mt-1"
                  value={profile[key as keyof typeof profile]}
                  onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))}
                />
              </div>
            ))}
            <div className="md:col-span-2 flex justify-end">
              <Button variant="outline" onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                Save profile
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" />Product & inventory</CardTitle>
            <CardDescription>Stock alert thresholds for your listings.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Low stock alert (units)</label>
              <Input type="number" min="0" className="mt-1" value={prefs.product.lowStockAlert}
                onChange={(e) => updateNested("product", "lowStockAlert", Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium">Critical stock (units)</label>
              <Input type="number" min="0" className="mt-1" value={prefs.product.criticalStock}
                onChange={(e) => updateNested("product", "criticalStock", Number(e.target.value))} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium">Notification method</label>
              <Select className="mt-1" value={prefs.product.notificationMethod}
                onValueChange={(v) => updateNested("product", "notificationMethod", v)}>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="push">Push</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShoppingBag className="h-5 w-5" />Order management</CardTitle>
            <CardDescription>Defaults applied to incoming orders.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Order timeout (min)</label>
              <Input type="number" min="0" className="mt-1" value={prefs.orders.orderTimeout}
                onChange={(e) => updateNested("orders", "orderTimeout", Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium">Max orders / day</label>
              <Input type="number" min="0" className="mt-1" value={prefs.orders.maxOrdersPerDay}
                onChange={(e) => updateNested("orders", "maxOrdersPerDay", Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium">Minimum order value (Rs)</label>
              <Input type="number" min="0" className="mt-1" value={prefs.orders.minOrderValue}
                onChange={(e) => updateNested("orders", "minOrderValue", Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium">Delivery radius (km)</label>
              <Input type="number" min="0" className="mt-1" value={prefs.orders.deliveryRadius}
                onChange={(e) => updateNested("orders", "deliveryRadius", Number(e.target.value))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Delivery settings</CardTitle>
            <CardDescription>Your self-delivery preferences. Final fees follow platform rules.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Free delivery radius (km)</label>
              <Input type="number" min="0" step="0.5" className="mt-1" value={prefs.delivery.freeDeliveryRadiusKm}
                onChange={(e) => updateNested("delivery", "freeDeliveryRadiusKm", Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium">Base delivery fee (₹)</label>
              <Input type="number" min="0" step="0.5" className="mt-1" value={prefs.delivery.baseFee}
                onChange={(e) => updateNested("delivery", "baseFee", Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium">Additional fee / km (₹)</label>
              <Input type="number" min="0" step="0.5" className="mt-1" value={prefs.delivery.perKmRate}
                onChange={(e) => updateNested("delivery", "perKmRate", Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium">Maximum delivery radius (km)</label>
              <Input type="number" min="0" step="0.5" className="mt-1" value={prefs.delivery.maxRadiusKm}
                onChange={(e) => updateNested("delivery", "maxRadiusKm", Number(e.target.value))} />
            </div>
            <div>
              <label className="text-sm font-medium">Minimum order (₹)</label>
              <Input type="number" min="0" className="mt-1" value={prefs.delivery.minOrderValue}
                onChange={(e) => updateNested("delivery", "minOrderValue", Number(e.target.value))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between rounded-lg border p-3 text-sm font-medium">
                Allow self delivery
                <Switch checked={Boolean(prefs.delivery.allowSelfDelivery)} onCheckedChange={(v) => updateNested("delivery", "allowSelfDelivery", v)} aria-label="Allow self delivery" />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3 text-sm font-medium">
                Allow delivery partners
                <Switch checked={Boolean(prefs.delivery.allowDeliveryPartners)} onCheckedChange={(v) => updateNested("delivery", "allowDeliveryPartners", v)} aria-label="Allow delivery partners" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" />Payments & payouts</CardTitle>
            <CardDescription>Bank details for your earnings.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium">Bank / UPI account</label>
              <Input className="mt-1" value={prefs.payouts.bankAccount}
                onChange={(e) => updateNested("payouts", "bankAccount", e.target.value)} placeholder="UPI ID or account reference" />
            </div>
            <div>
              <label className="text-sm font-medium">Account holder</label>
              <Input className="mt-1" value={prefs.payouts.accountHolder}
                onChange={(e) => updateNested("payouts", "accountHolder", e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Account number</label>
              <Input className="mt-1" value={prefs.payouts.accountNumber}
                onChange={(e) => updateNested("payouts", "accountNumber", e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">IFSC code</label>
              <Input className="mt-1" value={prefs.payouts.ifsc}
                onChange={(e) => updateNested("payouts", "ifsc", e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Payout frequency</label>
              <Select className="mt-1" value={prefs.payouts.payoutFrequency}
                onValueChange={(v) => updateNested("payouts", "payoutFrequency", v)}>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Minimum payout (Rs)</label>
              <Input type="number" min="0" className="mt-1" value={prefs.payouts.minPayout}
                onChange={(e) => updateNested("payouts", "minPayout", Number(e.target.value))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />AI & analytics</CardTitle>
            <CardDescription>Smart tools to grow your farm business.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {toggleRow("Price prediction", "pricePrediction")}
            {toggleRow("Demand forecast", "demandForecast")}
            {toggleRow("Weather integration", "weatherIntegration")}
            {toggleRow("Smart recommendations", "smartRecommendations")}
            {toggleRow("Daily report", "dailyReport")}
            {toggleRow("Weekly report", "weeklyReport")}
            {toggleRow("Monthly report", "monthlyReport")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Alerts & security</CardTitle>
            <CardDescription>How you hear about orders and account safety.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {toggleRow("New order alert", "newOrderAlert")}
            {toggleRow("Order cancelled alert", "orderCancelled")}
            {toggleRow("Payment received alert", "paymentReceived")}
            {toggleRow("Low stock alerts", "lowStockAlerts")}
            {toggleRow("Auto-accept small orders", "autoAcceptSmallOrders")}
            <div className="pt-1">
              <Badge variant="outline">Two-factor auth off</Badge>
              <p className="mt-2 text-xs text-muted-foreground">Account recovery and device controls are on the roadmap.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
