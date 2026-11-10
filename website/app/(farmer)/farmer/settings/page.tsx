"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Badge } from "../../../components/ui/badge";
import { Bot, CreditCard, Loader2, Package, Save, Shield, ShoppingBag, Store, Truck, Settings2, CheckCircle2 } from "lucide-react";
import { VerificationStatusCard } from "../../../components/security/verification-status";
import toast from "react-hot-toast";

function SettingsToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="settings-modern-switch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        width: 44,
        minWidth: 44,
        maxWidth: 44,
        height: 24,
        minHeight: 24,
        maxHeight: 24,
        flexShrink: 0,
        padding: 2,
        boxSizing: "border-box",
        border: 0,
        borderRadius: 9999,
        backgroundColor: checked ? "#059669" : "#cbd5e1",
        cursor: "pointer",
        transition: "background-color 180ms ease",
        verticalAlign: "middle",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "block",
          width: 20,
          minWidth: 20,
          height: 20,
          borderRadius: "50%",
          backgroundColor: "#ffffff",
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.25)",
          transition: "transform 180ms ease",
        }}
      />
    </button>
  );
}

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

  const { data: profileData, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ["farmerProfile"],
    queryFn: () => api.get("/farmers/me/profile"),
    enabled: Boolean(accessToken),
  });

  const { data: settingsData, isLoading: settingsLoading, isError: settingsError } = useQuery({
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

  const toggle = (field: ToggleKeys, nextValue?: boolean) => {
    const section = (["pricePrediction", "demandForecast", "weatherIntegration", "smartRecommendations", "dailyReport", "weeklyReport", "monthlyReport"].includes(field))
      ? "ai"
      : (["newOrderAlert", "orderCancelled", "paymentReceived", "autoAcceptSmallOrders", "lowStockAlerts"].includes(field))
        ? "alerts"
        : "payouts";
    setPrefs((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: typeof nextValue === "boolean" ? nextValue : !current[section][field],
      },
    }));
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
    } catch (err: any) {
      toast.error(err?.message || "Unable to save farm profile");
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
      <SettingsToggle checked={Boolean(prefs.alerts[key] ?? prefs.ai[key] ?? prefs.payouts[key])} onChange={(nextValue) => toggle(key, nextValue)} label={`Toggle ${label}`} />
    </div>
  );

  return (
    <div className="!mx-0 w-full max-w-none space-y-5 pb-8">
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Settings2 className="h-6 w-6" /></div>
          <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Farmer Settings</h1><p className="mt-1 text-sm text-slate-600">Manage your profile, preferences and platform settings.</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveProfile} disabled={savingProfile || profileLoading} className="h-10 rounded-xl bg-emerald-700 px-5 hover:bg-emerald-800">{savingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Profile</Button>
          <Button variant="outline" onClick={savePrefs} disabled={savingPrefs || settingsLoading} className="h-10 rounded-xl border-emerald-200 px-5 text-emerald-800 hover:bg-emerald-50">{savingPrefs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Preferences</Button>
        </div>
      </div>
      {lastSaved && <p className="text-right text-xs text-emerald-700">Preferences saved at {lastSaved}</p>}
      {(profileError || settingsError) && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Some saved settings could not be loaded. Check your connection and refresh before making changes.</div>}

      <Card className="w-full overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-emerald-100 bg-emerald-50/60 pb-4"><CardTitle className="flex items-center gap-2 text-slate-900"><Store className="h-5 w-5 text-emerald-700" />Profile Details</CardTitle><CardDescription>Keep your personal and farm information up to date.</CardDescription></CardHeader>
        <CardContent className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_230px]">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:col-span-2">
            {[
              ["ownerName", "Full Name"], ["email", "Email Address"], ["phone", "Phone Number"],
              ["farmAddress", "Farm Address"], ["city", "City"], ["farmName", "Farm Name"],
            ].map(([key, label]) => <div key={key} className="min-w-0"><label className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</label><Input className="h-10 w-full rounded-lg border-slate-200 bg-white" value={profile[key as keyof typeof profile]} onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
            <div className="sm:col-span-2"><label className="mb-1.5 block text-xs font-semibold text-slate-700">Pickup Instructions</label><Input className="h-10 w-full rounded-lg border-slate-200" value={profile.pickupInstructions} onChange={(event) => setProfile((current) => ({ ...current, pickupInstructions: event.target.value }))} placeholder="Landmark, gate details or contact instructions" /></div>
            <div className="sm:col-span-2"><label className="mb-1.5 block text-xs font-semibold text-slate-700">Weekly Pickup Window</label><Input className="h-10 w-full rounded-lg border-slate-200" value={profile.weeklyPickupWindow} onChange={(event) => setProfile((current) => ({ ...current, weeklyPickupWindow: event.target.value }))} /></div>
          </div>
          <div className="flex min-h-[190px] flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
            <p className="mb-3 text-sm font-semibold text-slate-800">Profile Photo</p>
            <div className="mb-3 flex h-24 w-24 items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-100 text-3xl font-bold text-emerald-700 shadow-sm">{(profile.ownerName || userName).trim().charAt(0).toUpperCase()}</div>
            <p className="text-xs text-slate-500">Your farm profile is visible to buyers and delivery partners.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-emerald-100 bg-emerald-50/50 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Truck className="h-5 w-5 text-emerald-700" />Delivery settings</CardTitle><CardDescription>Your self-delivery preferences. Final fees follow platform rules.</CardDescription></CardHeader>
          <CardContent className="space-y-3 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Free delivery radius (km)</label><Input type="number" min="0" step="0.5" className="h-10" value={prefs.delivery.freeDeliveryRadiusKm} onChange={(e) => updateNested("delivery", "freeDeliveryRadiusKm", Number(e.target.value))} /></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Base delivery fee (₹)</label><Input type="number" min="0" step="0.5" className="h-10" value={prefs.delivery.baseFee} onChange={(e) => updateNested("delivery", "baseFee", Number(e.target.value))} /></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Additional fee / km (₹)</label><Input type="number" min="0" step="0.5" className="h-10" value={prefs.delivery.perKmRate} onChange={(e) => updateNested("delivery", "perKmRate", Number(e.target.value))} /></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Maximum delivery radius (km)</label><Input type="number" min="0" step="0.5" className="h-10" value={prefs.delivery.maxRadiusKm} onChange={(e) => updateNested("delivery", "maxRadiusKm", Number(e.target.value))} /></div>
              <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Minimum order (₹)</label><Input type="number" min="0" className="h-10" value={prefs.delivery.minOrderValue} onChange={(e) => updateNested("delivery", "minOrderValue", Number(e.target.value))} /></div>
            </div>
            <div className="space-y-1 border-t border-slate-100 pt-2">
              <div className="flex items-center justify-between py-2 text-sm"><span className="font-medium text-slate-700">Allow self delivery</span><SettingsToggle checked={Boolean(prefs.delivery.allowSelfDelivery)} onChange={(v) => updateNested("delivery", "allowSelfDelivery", v)} label="Allow self delivery" /></div>
              <div className="flex items-center justify-between py-2 text-sm"><span className="font-medium text-slate-700">Allow delivery partners</span><SettingsToggle checked={Boolean(prefs.delivery.allowDeliveryPartners)} onChange={(v) => updateNested("delivery", "allowDeliveryPartners", v)} label="Allow delivery partners" /></div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-emerald-100 bg-emerald-50/50 pb-3"><CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-5 w-5 text-emerald-700" />Payments & payouts</CardTitle><CardDescription>Bank details for your earnings.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="mb-1.5 block text-xs font-semibold text-slate-700">Bank / UPI account</label><Input className="h-10" value={prefs.payouts.bankAccount} onChange={(e) => updateNested("payouts", "bankAccount", e.target.value)} placeholder="UPI ID or account reference" /></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Account holder</label><Input className="h-10" value={prefs.payouts.accountHolder} onChange={(e) => updateNested("payouts", "accountHolder", e.target.value)} /></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Account number</label><Input className="h-10" value={prefs.payouts.accountNumber} onChange={(e) => updateNested("payouts", "accountNumber", e.target.value)} /></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">IFSC code</label><Input className="h-10" value={prefs.payouts.ifsc} onChange={(e) => updateNested("payouts", "ifsc", e.target.value)} /></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Payout frequency</label><Select className="h-10" value={prefs.payouts.payoutFrequency} onValueChange={(v) => updateNested("payouts", "payoutFrequency", v)}><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="biweekly">Bi-weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent></Select></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Minimum payout (₹)</label><Input type="number" min="0" className="h-10" value={prefs.payouts.minPayout} onChange={(e) => updateNested("payouts", "minPayout", Number(e.target.value))} /></div>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-emerald-100 bg-emerald-50/50 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-5 w-5 text-emerald-700" />AI & analytics</CardTitle><CardDescription>Smart tools to grow your farm business.</CardDescription></CardHeader>
          <CardContent className="divide-y divide-slate-100 px-5 py-2">
            {toggleRow("Price prediction", "pricePrediction")}{toggleRow("Demand forecast", "demandForecast")}{toggleRow("Weather integration", "weatherIntegration")}{toggleRow("Smart recommendations", "smartRecommendations")}{toggleRow("Daily report", "dailyReport")}{toggleRow("Weekly report", "weeklyReport")}{toggleRow("Monthly report", "monthlyReport")}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-emerald-100 bg-emerald-50/50 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Shield className="h-5 w-5 text-emerald-700" />Alerts & security</CardTitle><CardDescription>How you hear about orders and account safety.</CardDescription></CardHeader>
          <CardContent className="divide-y divide-slate-100 px-5 py-2">
            {toggleRow("New order alert", "newOrderAlert")}{toggleRow("Order cancelled alert", "orderCancelled")}{toggleRow("Payment received alert", "paymentReceived")}{toggleRow("Low stock alerts", "lowStockAlerts")}{toggleRow("Auto-accept small orders", "autoAcceptSmallOrders")}
            <div className="my-2 rounded-lg bg-slate-50 p-3"><Badge variant="outline">Two-factor auth off</Badge><p className="mt-2 text-xs text-slate-500">Account recovery and device controls are not available yet.</p></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
