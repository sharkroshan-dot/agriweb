"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, ShieldCheck, LockKeyhole, SlidersHorizontal, CreditCard, User,
  ChevronRight, Loader2, Save, KeyRound, Package, Truck, WalletCards,
  RotateCcw, Tag, MessageSquare, Mail, Smartphone, Sun, Moon, Monitor,
  Send, Database, Eye, Download, PauseCircle, Trash2, Settings2, CheckCircle2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const NOTIFICATION_ITEMS = [
  { key: "orderUpdates", label: "Order Updates", description: "Order confirmation, preparation and dispatch updates.", icon: Package },
  { key: "deliveryStatus", label: "Delivery Updates", description: "Pickup, partner assignment and out-for-delivery updates.", icon: Truck },
  { key: "paymentConfirmations", label: "Payment Updates", description: "Payment confirmation, failure and refund status.", icon: WalletCards },
  { key: "returnUpdates", label: "Return & Refunds", description: "Updates on return requests and refund processing.", icon: RotateCcw },
  { key: "promotions", label: "Offers & Promotions", description: "Deals, seasonal offers and personalized recommendations.", icon: Tag },
  { key: "chatMessages", label: "Messages", description: "Messages from farmers, businesses and delivery partners.", icon: MessageSquare },
] as const;

const CHANNEL_ITEMS = [
  { key: "email", label: "Email", description: "Receive important updates via email.", icon: Mail },
  { key: "sms", label: "SMS", description: "Receive order and delivery alerts via SMS.", icon: Smartphone },
  { key: "push", label: "Push Notification", description: "Get real-time updates in your browser or app.", icon: Bell },
] as const;

const initialNotifications: Record<string, boolean> = {
  orderUpdates: true, deliveryStatus: true, paymentConfirmations: true,
  returnUpdates: true, promotions: false, chatMessages: true,
  email: true, sms: true, push: true,
};

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

const panelClass = "rounded-2xl border border-slate-200 bg-white shadow-sm";
const iconBubble = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700";

export default function CustomerSettingsPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [notifications, setNotifications] = useState<Record<string, boolean>>(initialNotifications);
  const [language, setLanguage] = useState("en");
  const [theme, setTheme] = useState("system");
  const [saving, setSaving] = useState(false);
  const [pwFields, setPwFields] = useState({ current: "", next: "", confirm: "" });
  const [changingPassword, setChangingPassword] = useState(false);

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["mySettings"],
    queryFn: () => api.get("/settings/mine"),
    enabled: Boolean(accessToken),
  });

  useEffect(() => {
    const saved = settingsData?.data;
    if (saved?.notifications) setNotifications((current) => ({ ...current, ...saved.notifications }));
    if (saved?.preferences) {
      setLanguage(saved.preferences.language || "en");
      setTheme(saved.preferences.theme || "system");
    }
  }, [settingsData?.data]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await api.put("/settings/mine", { notifications, preferences: { language, theme } });
      toast.success("Settings saved successfully");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (!pwFields.current || !pwFields.next) return toast.error("Enter your current and new password");
    if (pwFields.next !== pwFields.confirm) return toast.error("New passwords do not match");
    if (pwFields.next.length < 8) return toast.error("Use at least 8 characters for your new password");
    setChangingPassword(true);
    try {
      await api.post("/users/me/change-password", { current_password: pwFields.current, new_password: pwFields.next });
      toast.success("Password changed successfully");
      setPwFields({ current: "", next: "", confirm: "" });
    } catch (err: any) {
      let message = err?.message || "Failed to change password";
      try { const parsed = JSON.parse(message); message = parsed.detail || message; } catch {}
      toast.error(message);
    } finally {
      setChangingPassword(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-5 p-5"><div className="h-28 animate-pulse rounded-2xl bg-emerald-50" /><div className="h-[520px] animate-pulse rounded-2xl bg-slate-100" /></div>;
  }

  return (
    <div className="space-y-4 px-3 py-4 sm:px-5 lg:px-6">
      <header className="relative isolate min-h-[112px] overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-white via-emerald-50 to-sky-100 px-5 py-5 shadow-sm sm:min-h-[126px] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[58%] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/55 to-transparent" />
          <div className="absolute -bottom-10 right-[-4%] h-28 w-[110%] -rotate-3 rounded-[50%] bg-gradient-to-b from-lime-300 to-emerald-500 opacity-70" />
          <div className="absolute -bottom-12 right-[12%] h-32 w-[70%] -rotate-6 rounded-[50%] bg-gradient-to-b from-emerald-200 to-green-600 opacity-65" />
          <div className="absolute bottom-3 right-[22%] h-20 w-[55%] -rotate-6 rounded-[50%] bg-gradient-to-b from-sky-200 to-emerald-300 opacity-75" />
          <div className="absolute bottom-0 right-0 h-8 w-full bg-gradient-to-t from-green-500/30 to-transparent" />
        </div>
        <div className="relative z-10 flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-4 ring-white/70">
            <Settings2 className="h-9 w-9" />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Settings</p>
            <p className="mt-1 max-w-xl text-sm font-medium text-slate-700">Manage your account, notifications, security, privacy and preferences.</p>
          </div>
        </div>
      </header>

      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1.35fr)_minmax(300px,1fr)]">
        <nav className={panelClass + " h-fit p-2"} aria-label="Settings sections">
          {[
            { href: "#notifications", label: "Notifications", icon: Bell },
            { href: "#security", label: "Security & Login", icon: ShieldCheck },
            { href: "#privacy", label: "Privacy", icon: LockKeyhole },
            { href: "#preferences", label: "Preferences", icon: SlidersHorizontal },
            { href: "#payments", label: "Payment Settings", icon: CreditCard },
            { href: "#account", label: "Account Management", icon: User },
          ].map(({ href, label, icon: Icon }, index) => (
            <a key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition hover:bg-emerald-50 hover:text-emerald-800 ${index === 0 ? "bg-emerald-100 text-emerald-800" : "text-slate-700"}`}>
              <Icon className="h-5 w-5" />{label}
            </a>
          ))}
        </nav>

        <section id="notifications" className={panelClass + " scroll-mt-5 p-4 sm:p-5"}>
          <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3">
            <div className={iconBubble}><Bell className="h-6 w-6" /></div>
            <div><h2 className="text-lg font-bold text-slate-950">Notification Preferences</h2><p className="text-xs text-slate-600">Choose what updates you want to receive from AgriConnect.</p></div>
          </div>
          <div className="divide-y divide-slate-100">
            {NOTIFICATION_ITEMS.map(({ key, label, description, icon: Icon }) => (
              <div key={key} className="flex items-center gap-3 py-3">
                <div className={iconBubble}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-900">{label}</p><p className="text-xs leading-5 text-slate-600">{description}</p></div>
                <SettingsToggle checked={Boolean(notifications[key])} onChange={(checked) => setNotifications((current) => ({ ...current, [key]: checked }))} label={`Toggle ${label}`} />
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-3">
          <section className={panelClass + " p-4"}>
            <div className="mb-2 flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className={iconBubble}><Send className="h-5 w-5" /></div>
              <div><h2 className="text-lg font-bold text-slate-950">Communication Channels</h2><p className="text-xs text-slate-600">Choose how you want to receive notifications.</p></div>
            </div>
            {CHANNEL_ITEMS.map(({ key, label, description, icon: Icon }) => (
              <div key={key} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-0">
                <SettingsToggle checked={Boolean(notifications[key])} onChange={(checked) => setNotifications((current) => ({ ...current, [key]: checked }))} label={`Enable ${label}`} />
                <Icon className="h-5 w-5 text-emerald-700" />
                <div className="min-w-0"><p className="text-sm font-bold text-slate-900">{label}</p><p className="text-xs text-slate-600">{description}</p></div>
              </div>
            ))}
          </section>

          <section id="preferences" className={panelClass + " scroll-mt-5 p-4"}>
            <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3"><div className={iconBubble}><SlidersHorizontal className="h-5 w-5" /></div><h2 className="text-lg font-bold text-slate-950">Preferences</h2></div>
            <div className="space-y-3">
              <div><p className="mb-2 text-sm font-bold text-slate-900">Language</p><div className="grid grid-cols-3 gap-2">
                {[["en","English"],["ta","தமிழ் (Tamil)"],["hi","हिंदी (Hindi)"]].map(([value,label]) => <button key={value} type="button" onClick={() => setLanguage(value)} className={`rounded-lg border px-2 py-2 text-xs font-semibold ${language === value ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>{language === value ? "● " : "○ "}{label}</button>)}
              </div></div>
              <div><p className="mb-2 text-sm font-bold text-slate-900">Appearance</p><div className="grid grid-cols-3 gap-2">
                {[["system","System",Monitor],["light","Light",Sun],["dark","Dark",Moon]].map(([value,label,Icon]: any) => <button key={value} type="button" onClick={() => setTheme(value)} className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold ${theme === value ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}><Icon className="h-4 w-4" />{label}</button>)}
              </div></div>
            </div>
          </section>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <section id="security" className={panelClass + " scroll-mt-5 p-4"}>
          <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3"><div className={iconBubble}><ShieldCheck className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-slate-950">Security & Login</h2><p className="text-xs text-slate-600">Keep your account safe and secure.</p></div></div>
          <div className="space-y-3">
            <div className="flex items-center gap-3"><div className={iconBubble}><KeyRound className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">Change Password</p><p className="text-xs text-slate-600">Update your account password.</p></div></div>
            <div className="grid gap-2">
              <Input type="password" value={pwFields.current} onChange={(e) => setPwFields((v) => ({ ...v, current: e.target.value }))} placeholder="Current password" aria-label="Current password" />
              <Input type="password" value={pwFields.next} onChange={(e) => setPwFields((v) => ({ ...v, next: e.target.value }))} placeholder="New password (8+ characters)" aria-label="New password" />
              <Input type="password" value={pwFields.confirm} onChange={(e) => setPwFields((v) => ({ ...v, confirm: e.target.value }))} placeholder="Confirm new password" aria-label="Confirm new password" />
              <Button onClick={changePassword} disabled={changingPassword} size="sm" className="w-fit">{changingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update Password</Button>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3"><div><p className="text-sm font-bold">Two-Factor Authentication (2FA)</p><p className="text-xs text-slate-600">An extra layer of account security.</p></div><span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">Not enabled</span></div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3"><div><p className="text-sm font-bold">Login Activity</p><p className="text-xs text-slate-600">Recent device and login history.</p></div><span className="text-[10px] text-slate-500">Coming soon</span></div>
          </div>
        </section>

        <section id="privacy" className={panelClass + " scroll-mt-5 p-4"}>
          <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3"><div className={iconBubble}><LockKeyhole className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-slate-950">Privacy</h2><p className="text-xs text-slate-600">Control your data and privacy.</p></div></div>
          <div className="space-y-3">
            <div className="flex items-center gap-3"><div className={iconBubble}><Database className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">Data & Privacy</p><p className="text-xs text-slate-600">Manage how your account information is used.</p></div><ChevronRight className="h-4 w-4 text-slate-400" /></div>
            <div className="flex items-center gap-3 border-t border-slate-100 pt-3"><div className={iconBubble}><Eye className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">Profile Visibility</p><p className="text-xs text-slate-600">Your contact details are shared only when needed for orders.</p></div></div>
            <div className="flex items-center gap-3 border-t border-slate-100 pt-3"><div className={iconBubble}><Download className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">Download My Data</p><p className="text-xs text-slate-600">Data export is not available yet.</p></div><span className="text-[10px] text-slate-500">Coming soon</span></div>
          </div>
        </section>

        <section id="account" className={panelClass + " scroll-mt-5 p-4"}>
          <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3"><div className={iconBubble}><User className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-slate-950">Account Management</h2><p className="text-xs text-slate-600">Manage your account and related services.</p></div></div>
          <div className="space-y-3">
            <Link href="/profile" className="flex items-center gap-3"><div className={iconBubble}><User className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">Personal Information</p><p className="text-xs text-slate-600">Update your profile and saved addresses.</p></div><ChevronRight className="h-4 w-4 text-slate-400" /></Link>
            <Link href="/payments" className="flex items-center gap-3 border-t border-slate-100 pt-3"><div className={iconBubble}><CreditCard className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">Payment Settings</p><p className="text-xs text-slate-600">View payments, wallet and transaction history.</p></div><ChevronRight className="h-4 w-4 text-slate-400" /></Link>
            <div className="flex items-center gap-3 border-t border-slate-100 pt-3"><div className={iconBubble}><PauseCircle className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">Deactivate / Delete Account</p><p className="text-xs text-slate-600">Contact support to request account closure.</p></div><span className="text-[10px] text-slate-500">Support</span></div>
          </div>
        </section>
      </div>

      <div className="flex flex-col-reverse gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs text-emerald-900"><CheckCircle2 className="h-4 w-4 shrink-0" /> Your changes are applied when you save your settings.</p>
        <Button onClick={saveSettings} disabled={saving} className="bg-emerald-700 hover:bg-emerald-800">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Settings</Button>
      </div>
    </div>
  );
}
