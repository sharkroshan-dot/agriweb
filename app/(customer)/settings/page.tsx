"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ChevronRight,
  KeyRound,
  Loader2,
  Lock,
  MapPin,
  Save,
  Shield,
  User,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const NOTIFICATION_DEFAULTS: Record<string, { label: string; description: string }> = {
  orderUpdates: { label: "Order updates", description: "Status changes for your orders" },
  deliveryStatus: { label: "Delivery status", description: "Live delivery tracking updates" },
  paymentConfirmations: { label: "Payment confirmations", description: "When a payment succeeds or fails" },
  promotions: { label: "Promotions & offers", description: "Discounts and special deals" },
  chatMessages: { label: "Chat messages", description: "Messages from farmers and partners" },
  push: { label: "Push notifications", description: "On-device notifications" },
  email: { label: "Email notifications", description: "Updates sent to your email" },
  sms: { label: "SMS notifications", description: "Updates sent by text message" },
};

export default function CustomerSettingsPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const [notifications, setNotifications] = useState<Record<string, boolean>>({
    orderUpdates: true,
    deliveryStatus: true,
    paymentConfirmations: true,
    promotions: false,
    chatMessages: true,
    push: true,
    email: true,
    sms: false,
  });
  const [savingNotifications, setSavingNotifications] = useState(false);

  const [pwFields, setPwFields] = useState({ current: "", next: "", confirm: "" });
  const [changingPassword, setChangingPassword] = useState(false);

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["mySettings"],
    queryFn: () => api.get("/settings/mine"),
    enabled: Boolean(accessToken),
  });

  useEffect(() => {
    const saved = settingsData?.data;
    if (saved?.notifications) {
      setNotifications((current) => ({ ...current, ...saved.notifications }));
    }
  }, [settingsData?.data]);

  const saveNotifications = async () => {
    setSavingNotifications(true);
    try {
      await api.put("/settings/mine", { notifications });
      toast.success("Notification preferences saved");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save preferences");
    } finally {
      setSavingNotifications(false);
    }
  };

  const changePassword = async () => {
    if (!pwFields.current || !pwFields.next) {
      toast.error("Enter your current and new password");
      return;
    }
    if (pwFields.next !== pwFields.confirm) {
      toast.error("New passwords do not match");
      return;
    }
    setChangingPassword(true);
    try {
      await api.post("/users/me/change-password", {
        current_password: pwFields.current,
        new_password: pwFields.next,
      });
      toast.success("Password changed successfully");
      setPwFields({ current: "", next: "", confirm: "" });
    } catch (err: any) {
      let message = err?.message || "Failed to change password";
      try {
        const parsed = JSON.parse(message);
        message = parsed.detail || message;
      } catch {
        // keep original message
      }
      toast.error(message);
    } finally {
      setChangingPassword(false);
    }
  };

  const quickLinks = [
    { href: "/profile", icon: User, title: "Profile", description: "Name, phone and photo" },
    { href: "/profile/addresses", icon: MapPin, title: "Addresses", description: "Saved delivery addresses" },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Manage your account, notifications and security.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-emerald-600" /> Account
            </CardTitle>
            <CardDescription>Profile details and saved delivery addresses.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quickLinks.map(({ href, icon: Icon, title, description }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center justify-between rounded-lg border p-3 transition hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50">
                    <Icon className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-slate-500">{description}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-emerald-600" /> Notifications
              </CardTitle>
              <CardDescription>Choose what you want to hear about.</CardDescription>
            </div>
            <Button size="sm" onClick={saveNotifications} disabled={savingNotifications}>
              {savingNotifications ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(NOTIFICATION_DEFAULTS).map(([key, { label, description }]) => (
              <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-slate-500">{description}</p>
                </div>
                <Switch
                  checked={Boolean(notifications[key])}
                  onCheckedChange={(checked) => setNotifications((current) => ({ ...current, [key]: checked }))}
                  aria-label={`Toggle ${label}`}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-emerald-600" /> Security
            </CardTitle>
            <CardDescription>Change your password to keep your account safe.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs font-medium text-slate-600">Current password</label>
                <Input
                  type="password"
                  className="mt-1"
                  value={pwFields.current}
                  onChange={(e) => setPwFields((f) => ({ ...f, current: e.target.value }))}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">New password</label>
                <Input
                  type="password"
                  className="mt-1"
                  value={pwFields.next}
                  onChange={(e) => setPwFields((f) => ({ ...f, next: e.target.value }))}
                  placeholder="8+ chars with A, a, 1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Confirm new password</label>
                <Input
                  type="password"
                  className="mt-1"
                  value={pwFields.confirm}
                  onChange={(e) => setPwFields((f) => ({ ...f, confirm: e.target.value }))}
                  placeholder="Repeat new password"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={changePassword} disabled={changingPassword}>
                {changingPassword ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
                Update password
              </Button>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <KeyRound className="h-3.5 w-3.5" /> Two-factor authentication is coming soon
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" /> Payments
            </CardTitle>
            <CardDescription>Cash and UPI are available at checkout. Saved cards are coming soon.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-slate-500">
              Payment methods are configured during checkout. Wallet balance and saved cards will appear here once available.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
