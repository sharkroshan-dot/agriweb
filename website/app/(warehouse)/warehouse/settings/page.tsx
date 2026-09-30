"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Loader2, MapPin, RefreshCw, Save, Settings, Snowflake, Warehouse } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

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
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Warehouse Settings</h1>
          <p className="text-muted-foreground">Manage warehouse profile, capacity, location, inventory and operational alerts.</p>
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && <span className="text-xs text-muted-foreground">Saved at {lastSaved}</span>}
          <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <form className="space-y-6 lg:col-span-2" onSubmit={handleSave}>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Warehouse className="h-5 w-5" />Profile</CardTitle><CardDescription>Core details shown across warehouse workflows.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div><label className="text-sm font-medium">Warehouse Name</label><Input value={form.name} onChange={(event) => updateForm("name", event.target.value)} className="mt-1" required /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Total Capacity</label>
                  <Input type="number" min="0" step="0.01" value={form.totalCapacity} onChange={(event) => updateForm("totalCapacity", event.target.value)} className="mt-1" required />
                  <p className="mt-1 text-xs text-muted-foreground">Maximum physical warehouse capacity. Entered by the warehouse manager.</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Cold Storage Capacity</label>
                  <Input type="number" min="0" step="0.01" value={form.coldStorageCapacity} onChange={(event) => updateForm("coldStorageCapacity", event.target.value)} className="mt-1" />
                  <p className="mt-1 text-xs text-muted-foreground">Used quantity is calculated automatically from cold-storage records.</p>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Warehouse status</p>
                <p className="mt-1 text-xs text-muted-foreground">Activation and verification are controlled by the warehouse workflow and cannot be changed here.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" />Location</CardTitle><CardDescription>Address and coordinates for routing and logistics.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div><label className="text-sm font-medium">Address Line 1</label><Input value={form.addressLine1} onChange={(event) => updateForm("addressLine1", event.target.value)} className="mt-1" /></div>
              <div><label className="text-sm font-medium">Address Line 2</label><Input value={form.addressLine2} onChange={(event) => updateForm("addressLine2", event.target.value)} className="mt-1" /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="text-sm font-medium">City</label><Input value={form.city} onChange={(event) => updateForm("city", event.target.value)} className="mt-1" /></div>
                <div><label className="text-sm font-medium">State</label><Input value={form.state} onChange={(event) => updateForm("state", event.target.value)} className="mt-1" /></div>
                <div><label className="text-sm font-medium">Postal Code</label><Input value={form.postalCode} onChange={(event) => updateForm("postalCode", event.target.value)} className="mt-1" /></div>
                <div><label className="text-sm font-medium">Country</label><Input value={form.country} onChange={(event) => updateForm("country", event.target.value)} className="mt-1" /></div>
                <div><label className="text-sm font-medium">Latitude</label><Input type="number" step="any" value={form.latitude} onChange={(event) => updateForm("latitude", event.target.value)} className="mt-1" /></div>
                <div><label className="text-sm font-medium">Longitude</label><Input type="number" step="any" value={form.longitude} onChange={(event) => updateForm("longitude", event.target.value)} className="mt-1" /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" />Inventory & stock alerts</CardTitle><CardDescription>When to warn staff about low stock.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div><label className="text-sm font-medium">Low stock alert (units)</label><Input type="number" min="0" value={prefs.lowStockAlert} onChange={(event) => updatePrefs("lowStockAlert", Number(event.target.value))} className="mt-1" /></div>
              <div><label className="text-sm font-medium">Critical stock (units)</label><Input type="number" min="0" value={prefs.criticalStock} onChange={(event) => updatePrefs("criticalStock", Number(event.target.value))} className="mt-1" /></div>
              <div>
                <label className="text-sm font-medium">Alert frequency</label>
                <Select className="mt-1" value={prefs.alertFrequency} onValueChange={(v) => updatePrefs("alertFrequency", v)}>
                  <SelectContent>
                    <SelectItem value="immediate">Immediate</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end pb-1">
                <div className="flex w-full items-center justify-between rounded-lg border p-3 text-sm font-medium">
                  Low stock warnings
                  <Switch checked={prefs.lowStockAlerts} onCheckedChange={(on) => updatePrefs("lowStockAlerts", on)} aria-label="Low stock warnings" />
                </div>
              </div>
              <div className="flex items-end pb-1">
                <div className="flex w-full items-center justify-between rounded-lg border p-3 text-sm font-medium">
                  Expiry alerts
                  <Switch checked={prefs.expiryAlerts} onCheckedChange={(on) => updatePrefs("expiryAlerts", on)} aria-label="Expiry alerts" />
                </div>
              </div>
              <div className="flex items-end pb-1">
                <div className="flex w-full items-center justify-between rounded-lg border p-3 text-sm font-medium">
                  Incoming stock updates
                  <Switch checked={prefs.incomingAlerts} onCheckedChange={(on) => updatePrefs("incomingAlerts", on)} aria-label="Incoming stock updates" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />Warehouse operations</CardTitle><CardDescription>Control checks used during receiving and inventory handling.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {[
                ["allowStockReceiving", "Allow stock receiving", "Warehouse staff can receive incoming stock."],
                ["requireQualityCheck", "Require quality check", "Receiving must pass a quality check before stock is added."],
                ["requireBatchNumber", "Require batch number", "Batch identification is required for received stock."],
                ["trackExpiryDates", "Track expiry dates", "Inventory records can carry expiry information."],
                ["requireStorageLocation", "Require storage location", "Stock must be assigned to a storage location."],
                ["lowCapacityAlerts", "Low capacity alerts", "Notify staff when warehouse capacity is getting high."],
              ].map(([key, title, description]) => (
                <div key={key} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div>
                  <Switch checked={Boolean(prefs[key as keyof typeof prefs])} onCheckedChange={(on) => updatePrefs(key as keyof typeof prefs, on)} aria-label={title} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Snowflake className="h-5 w-5" />Cold storage settings</CardTitle><CardDescription>Environment defaults for cold rooms.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div><label className="text-sm font-medium">Default temperature (°C)</label><Input type="number" step="0.5" value={prefs.defaultTemperature} onChange={(event) => updatePrefs("defaultTemperature", Number(event.target.value))} className="mt-1" /></div>
              <div><label className="text-sm font-medium">Default humidity (%)</label><Input type="number" min="0" max="100" value={prefs.defaultHumidity} onChange={(event) => updatePrefs("defaultHumidity", Number(event.target.value))} className="mt-1" /></div>
              <div><label className="text-sm font-medium">Alert threshold (±°C)</label><Input type="number" step="0.5" value={prefs.alertThreshold} onChange={(event) => updatePrefs("alertThreshold", Number(event.target.value))} className="mt-1" /></div>
              <div className="flex items-end pb-1">
                <div className="flex w-full items-center justify-between rounded-lg border p-3 text-sm font-medium">
                  Temperature alert
                  <Switch checked={prefs.temperatureAlert} onCheckedChange={(on) => updatePrefs("temperatureAlert", on)} aria-label="Temperature alert" />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => refetch()}>Reset</Button>
            <Button type="submit" disabled={isSaving}><Save className="mr-2 h-4 w-4" />{isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save Settings</Button>
          </div>
        </form>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />Status</CardTitle><CardDescription>Used capacity is calculated automatically from live inventory records.</CardDescription></CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="flex justify-between text-sm"><span>General Capacity</span><span className="font-medium">{warehouse?.usedCapacity ?? 0} / {warehouse?.totalCapacity ?? 0}</span></div>
                <Progress value={warehouse?.totalCapacity ? Math.min(100, ((warehouse.usedCapacity ?? 0) / warehouse.totalCapacity) * 100) : 0} className="mt-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm"><span>Cold Storage</span><span className="font-medium">{warehouse?.coldStorageUsed ?? 0} / {warehouse?.coldStorageCapacity ?? 0}</span></div>
                <Progress value={warehouse?.coldStorageCapacity ? Math.min(100, ((warehouse.coldStorageUsed ?? 0) / warehouse.coldStorageCapacity) * 100) : 0} className="mt-2" />
              </div>
              <Badge variant={warehouse?.isActive ? "success" : "secondary"}>{warehouse?.isActive ? "Active" : "Inactive"}</Badge>
              <div className="rounded-lg border p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">System calculated</p><p className="mt-1">Used capacity comes from live inventory, receiving, dispatch and transfer records. Managers never enter it manually.</p></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
