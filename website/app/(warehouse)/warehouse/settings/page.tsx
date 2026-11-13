"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Loader2, MapPin, RefreshCw, Save, Settings, Snowflake, Warehouse, LocateFixed } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";
import { WarehousePageHeader } from "../../../components/warehouse/warehouse-page-header";
import { api } from "../../../lib/api/client";
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
      <span aria-hidden="true" style={{
        display: "block",
        width: 20,
        minWidth: 20,
        height: 20,
        borderRadius: "50%",
        backgroundColor: "#ffffff",
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.25)",
        transition: "transform 180ms ease",
      }} />
    </button>
  );
}

function SettingToggleRow({ title, description, checked, onChange }: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-emerald-200">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={checked ? "text-xs font-semibold text-emerald-700" : "text-xs font-medium text-slate-400"}>{checked ? "On" : "Off"}</span>
        <SettingsToggle checked={checked} onChange={onChange} label={title} />
      </div>
    </div>
  );
}

const emptyForm = {
  name: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "India",
  latitude: "",
  longitude: "",
  totalCapacity: "",
  coldStorageCapacity: "",
  serviceAreas: "",
  farmCollectionDistricts: "",
  supportedStorageTypes: "",
};

const emptyPrefs = {
  lowStockAlert: 20,
  criticalStock: 10,
  alertFrequency: "daily",
  defaultTemperature: 4,
  defaultHumidity: 65,
  temperatureAlert: true,
  alertThreshold: 2,
  lowStockAlerts: true,
  expiryAlerts: true,
  incomingAlerts: true,
  allowStockReceiving: true,
  requireQualityCheck: true,
  requireBatchNumber: true,
  trackExpiryDates: true,
  requireStorageLocation: true,
  lowCapacityAlerts: true,
};

export default function WarehouseSettingsPage() {
  const [form, setForm] = useState(emptyForm);
  const [prefs, setPrefs] = useState(emptyPrefs);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const { data: warehouse, isLoading, refetch } = useQuery({
    queryKey: ["warehouseSettings"],
    queryFn: () => api.get("/warehouse/me"),
  });

  const { data: settingsData, refetch: refetchPrefs } = useQuery({
    queryKey: ["warehouseSettingsPrefs"],
    queryFn: () => api.get("/settings/mine"),
  });

  useEffect(() => {
    if (!warehouse) {
      return;
    }

    setForm({
      name: warehouse.name || "",
      addressLine1: warehouse.address?.line1 || warehouse.address?.street || "",
      addressLine2: warehouse.address?.line2 || "",
      city: warehouse.address?.city || "",
      state: warehouse.address?.state || "",
      postalCode: warehouse.address?.postalCode || warehouse.address?.pincode || "",
      country: warehouse.address?.country || "India",
      latitude: warehouse.location?.coordinates?.[1] ? String(warehouse.location.coordinates[1]) : warehouse.location?.latitude ? String(warehouse.location.latitude) : "",
      longitude: warehouse.location?.coordinates?.[0] ? String(warehouse.location.coordinates[0]) : warehouse.location?.longitude ? String(warehouse.location.longitude) : "",
      totalCapacity: String(warehouse.totalCapacity ?? ""),
      coldStorageCapacity: String(warehouse.coldStorageCapacity ?? ""),
      serviceAreas: (warehouse.serviceAreas || []).join(", "),
      farmCollectionDistricts: (warehouse.farmCollectionDistricts || []).join(", "),
      supportedStorageTypes: (warehouse.supportedStorageTypes || []).join(", "),
    });
  }, [warehouse]);

  useEffect(() => {
    const saved = settingsData?.data;
    if (!saved) return;
    setPrefs((current) => ({
      ...current,
      ...(saved.inventory || {}),
      ...(saved.coldStorage || {}),
      ...(saved.alerts || {}),
      ...(saved.operations || {}),
    }));
  }, [settingsData?.data]);

  const updateForm = (field: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updatePrefs = (field: keyof typeof prefs, value: string | number | boolean) => {
    setPrefs((current) => ({ ...current, [field]: value }));
  };


  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Live location is not supported by this browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((current) => ({
          ...current,
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
        }));
        toast.success("Current live location captured");
      },
      (error) => {
        const message = error.code === 1
          ? "Location permission was denied. Allow location access and try again."
          : "Unable to get your current location. Please try again.";
        toast.error(message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setIsSaving(true);
      const latitude = Number(form.latitude || 0);
      const longitude = Number(form.longitude || 0);

      await api.put("/warehouse/me", {
        name: form.name.trim(),
        address: {
          line1: form.addressLine1.trim(),
          line2: form.addressLine2.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          postalCode: form.postalCode.trim(),
          country: form.country.trim(),
        },
        location: {
          type: "Point",
          coordinates: [longitude, latitude],
          latitude,
          longitude,
        },
        totalCapacity: Number(form.totalCapacity || 0),
        coldStorageCapacity: Number(form.coldStorageCapacity || 0),
        serviceAreas: form.serviceAreas.split(",").map((v) => v.trim()).filter(Boolean),
        farmCollectionDistricts: form.farmCollectionDistricts.split(",").map((v) => v.trim()).filter(Boolean),
        supportedStorageTypes: form.supportedStorageTypes.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean),
      });

      await api.put("/settings/mine", {
        inventory: {
          lowStockAlert: Number(prefs.lowStockAlert),
          criticalStock: Number(prefs.criticalStock),
          alertFrequency: prefs.alertFrequency,
        },
        coldStorage: {
          defaultTemperature: Number(prefs.defaultTemperature),
          defaultHumidity: Number(prefs.defaultHumidity),
          temperatureAlert: prefs.temperatureAlert,
          alertThreshold: Number(prefs.alertThreshold),
        },
        alerts: {
          lowStockAlerts: prefs.lowStockAlerts,
          expiryAlerts: prefs.expiryAlerts,
          incomingAlerts: prefs.incomingAlerts,
          lowCapacityAlerts: prefs.lowCapacityAlerts,
        },
        operations: {
          allowStockReceiving: prefs.allowStockReceiving,
          requireQualityCheck: prefs.requireQualityCheck,
          requireBatchNumber: prefs.requireBatchNumber,
          trackExpiryDates: prefs.trackExpiryDates,
          requireStorageLocation: prefs.requireStorageLocation,
        },
      });

      setLastSaved(new Date().toLocaleTimeString());
      toast.success("Warehouse settings saved");
      refetch();
      refetchPrefs();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-6 lg:grid-cols-3"><div className="h-96 animate-pulse rounded-lg bg-muted lg:col-span-2" /><div className="h-96 animate-pulse rounded-lg bg-muted" /></div>
      </div>
    );
  }

  return (
    <div className="warehouse-settings-page w-full max-w-none space-y-5 pb-8">
      <WarehousePageHeader
        eyebrow="Warehouse configuration"
        title="Warehouse Settings"
        description="Manage your warehouse profile, collection coverage, capacity and operational preferences."
        meta={<span>{lastSaved ? `Last saved at ${lastSaved}` : "Changes are applied when you save settings"}</span>}
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button type="button" variant="outline" size="sm" className="border-slate-200 bg-white" disabled={isSaving} onClick={() => { refetch(); refetchPrefs(); }}>
              <RefreshCw className="mr-2 h-4 w-4" />Reset
            </Button>
            <Button type="submit" form="warehouse-settings-form" size="sm" disabled={isSaving} className="bg-emerald-700 text-white hover:bg-emerald-800">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isSaving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        }
      />

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form id="warehouse-settings-form" className="min-w-0 space-y-5" onSubmit={handleSave}>
          <Card className="overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4"><CardTitle className="flex items-center gap-2"><Warehouse className="h-5 w-5" />Profile</CardTitle><CardDescription>Core details shown across warehouse workflows.</CardDescription></CardHeader>
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Warehouse Name</label><Input value={form.name} onChange={(event) => updateForm("name", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" required /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">Total Capacity</label>
                  <Input type="number" min="0" step="0.01" value={form.totalCapacity} onChange={(event) => updateForm("totalCapacity", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" required />
                  <p className="mt-1 text-xs text-muted-foreground">Maximum physical warehouse capacity. Entered by the warehouse manager.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">Cold Storage Capacity</label>
                  <Input type="number" min="0" step="0.01" value={form.coldStorageCapacity} onChange={(event) => updateForm("coldStorageCapacity", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" />
                  <p className="mt-1 text-xs text-muted-foreground">Used quantity is calculated automatically from cold-storage records.</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">Service Areas</label>
                  <Input value={form.serviceAreas} onChange={(event) => updateForm("serviceAreas", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" placeholder="Coimbatore, Tiruppur, Erode" />
                  <p className="mt-1 text-xs text-muted-foreground">Comma-separated districts/areas this warehouse can serve. This is not a fixed one-district assignment.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">Supported Storage Types</label>
                  <Input value={form.supportedStorageTypes} onChange={(event) => updateForm("supportedStorageTypes", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" placeholder="ambient, chilled, frozen" />
                  <p className="mt-1 text-xs text-muted-foreground">Leave empty to accept all storage types.</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="font-medium">Warehouse status</p>
                <p className="mt-1 text-xs text-muted-foreground">Activation and verification are controlled by the warehouse workflow and cannot be changed here.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4"><CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" />Farm Collection Districts</CardTitle>
              <CardDescription>Choose the districts this warehouse is responsible for collecting farm orders from. The Farm Collection queue will show pickups from these districts only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Districts to collect from</label>
                <Input value={form.farmCollectionDistricts} onChange={(event) => updateForm("farmCollectionDistricts", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" placeholder="Tiruchirappalli, Perambalur" aria-label="Farm collection districts" />
                <p className="mt-1 text-xs text-muted-foreground">Enter official district names separated by commas. Example: Tiruchirappalli. Use this setting for farm pickup coverage; Service Areas are separate and do not control the farm collection queue.</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="font-medium">How this affects Farm Collection</p>
                <p className="mt-1 text-xs text-muted-foreground">Only jobs whose farmer district matches a selected district are listed for route planning and pickup-team assignment. Orders without a verifiable district are not silently routed into another district.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4"><CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" />Location</CardTitle><CardDescription>Address and coordinates for routing and logistics.</CardDescription></CardHeader>
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Address Line 1</label><Input value={form.addressLine1} onChange={(event) => updateForm("addressLine1", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
              <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Address Line 2</label><Input value={form.addressLine2} onChange={(event) => updateForm("addressLine2", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">City</label><Input value={form.city} onChange={(event) => updateForm("city", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
                <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">State</label><Input value={form.state} onChange={(event) => updateForm("state", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
                <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Postal Code</label><Input value={form.postalCode} onChange={(event) => updateForm("postalCode", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
                <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Country</label><Input value={form.country} onChange={(event) => updateForm("country", event.target.value)} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
                <div className="sm:col-span-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="mb-1.5 block text-sm font-semibold text-slate-700">Warehouse live location</p>
                      <p className="text-xs text-muted-foreground">Use the device's current GPS location for routing and logistics. Latitude and longitude are stored automatically.</p>
                    </div>
                    <Button type="button" variant="outline" onClick={useCurrentLocation}>
                      <LocateFixed className="mr-2 h-4 w-4" />Use Current Live Location
                    </Button>
                  </div>
                  {(form.latitude && form.longitude) && (
                    <p className="mt-3 text-xs text-muted-foreground">Location captured and ready to save.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4"><CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" />Inventory & stock alerts</CardTitle><CardDescription>When to warn staff about low stock.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
              <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Low stock alert (units)</label><Input type="number" min="0" value={prefs.lowStockAlert} onChange={(event) => updatePrefs("lowStockAlert", Number(event.target.value))} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
              <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Critical stock (units)</label><Input type="number" min="0" value={prefs.criticalStock} onChange={(event) => updatePrefs("criticalStock", Number(event.target.value))} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Alert frequency</label>
                <Select className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" value={prefs.alertFrequency} onValueChange={(v) => updatePrefs("alertFrequency", v)}>
                  <SelectContent>
                    <SelectItem value="immediate">Immediate</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <SettingToggleRow title="Low stock warnings" description="Notify staff when available stock reaches the configured threshold." checked={prefs.lowStockAlerts} onChange={(on) => updatePrefs("lowStockAlerts", on)} />
              <SettingToggleRow title="Expiry alerts" description="Warn staff about stock approaching its expiry date." checked={prefs.expiryAlerts} onChange={(on) => updatePrefs("expiryAlerts", on)} />
              <SettingToggleRow title="Incoming stock updates" description="Notify staff when new shipments are assigned or received." checked={prefs.incomingAlerts} onChange={(on) => updatePrefs("incomingAlerts", on)} />
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4"><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />Warehouse operations</CardTitle><CardDescription>Control checks used during receiving and inventory handling.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
              {[
                ["allowStockReceiving", "Allow stock receiving", "Warehouse staff can receive incoming stock."],
                ["requireQualityCheck", "Require quality check", "Receiving must pass a quality check before stock is added."],
                ["requireBatchNumber", "Require batch number", "Batch identification is required for received stock."],
                ["trackExpiryDates", "Track expiry dates", "Inventory records can carry expiry information."],
                ["requireStorageLocation", "Require storage location", "Stock must be assigned to a storage location."],
                ["lowCapacityAlerts", "Low capacity alerts", "Notify staff when warehouse capacity is getting high."],
              ].map(([key, title, description]) => (
                <SettingToggleRow
                  key={key}
                  title={title}
                  description={description}
                  checked={Boolean(prefs[key as keyof typeof prefs])}
                  onChange={(on) => updatePrefs(key as keyof typeof prefs, on)}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4"><CardTitle className="flex items-center gap-2"><Snowflake className="h-5 w-5" />Cold storage settings</CardTitle><CardDescription>Environment defaults for cold rooms.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Default temperature (°C)</label><Input type="number" step="0.5" value={prefs.defaultTemperature} onChange={(event) => updatePrefs("defaultTemperature", Number(event.target.value))} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
              <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Default humidity (%)</label><Input type="number" min="0" max="100" value={prefs.defaultHumidity} onChange={(event) => updatePrefs("defaultHumidity", Number(event.target.value))} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
              <div><label className="mb-1.5 block text-sm font-semibold text-slate-700">Alert threshold (±°C)</label><Input type="number" step="0.5" value={prefs.alertThreshold} onChange={(event) => updatePrefs("alertThreshold", Number(event.target.value))} className="mt-1.5 h-10 rounded-lg border-slate-200 bg-white shadow-none focus-visible:ring-emerald-500" /></div>
              <SettingToggleRow title="Temperature alert" description="Alert staff when cold-room temperature moves beyond the configured threshold." checked={prefs.temperatureAlert} onChange={(on) => updatePrefs("temperatureAlert", on)} />
            </CardContent>
          </Card>

        </form>

        <div className="space-y-6">
          <Card className="overflow-hidden rounded-2xl border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4"><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />Status</CardTitle><CardDescription>Used capacity is calculated automatically from live inventory records.</CardDescription></CardHeader>
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-700">General capacity</span>
                  <span className="font-semibold tabular-nums text-slate-900">{warehouse?.totalCapacity ? `${Math.round(((warehouse.usedCapacity ?? 0) / warehouse.totalCapacity) * 100)}%` : "Not configured"}</span>
                </div>
                <Progress value={warehouse?.totalCapacity ? Math.min(100, ((warehouse.usedCapacity ?? 0) / warehouse.totalCapacity) * 100) : 0} className="h-2 bg-slate-100" />
                <p className="text-xs text-slate-500">{warehouse?.usedCapacity ?? 0} used of {warehouse?.totalCapacity ?? 0} total capacity</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-700">Cold storage</span>
                  <span className="font-semibold tabular-nums text-slate-900">{warehouse?.coldStorageCapacity ? `${Math.round(((warehouse.coldStorageUsed ?? 0) / warehouse.coldStorageCapacity) * 100)}%` : "Not configured"}</span>
                </div>
                <Progress value={warehouse?.coldStorageCapacity ? Math.min(100, ((warehouse.coldStorageUsed ?? 0) / warehouse.coldStorageCapacity) * 100) : 0} className="h-2 bg-slate-100" />
                <p className="text-xs text-slate-500">{warehouse?.coldStorageUsed ?? 0} used of {warehouse?.coldStorageCapacity ?? 0} total capacity</p>
              </div>
              <Badge variant={warehouse?.isActive ? "success" : "secondary"}>{warehouse?.isActive ? "Active" : "Inactive"}</Badge>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-muted-foreground"><p className="font-medium text-foreground">System calculated</p><p className="mt-1 leading-5 text-slate-500">Used capacity comes from live inventory, receiving, dispatch and transfer records. Managers never enter it manually.</p></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
