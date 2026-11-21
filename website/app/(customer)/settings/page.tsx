"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, ShieldCheck, LockKeyhole, SlidersHorizontal, CreditCard, User,
  ChevronRight, Loader2, Save, KeyRound, Package, Truck, WalletCards,
  RotateCcw, Tag, MessageSquare, Mail, Smartphone, Sun, Moon, Monitor,
  Send, Database, Eye, Download, PauseCircle, Trash2, Settings, CheckCircle2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";
import { useTheme } from "next-themes";

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
  const { theme, setTheme } = useTheme();
  const [notifications, setNotifications] = useState<Record<string, boolean>>(initialNotifications);
  const [language, setLanguage] = useState("en");
  const [saving, setSaving] = useState(false);
  const [pwFields, setPwFields] = useState({ current: "", next: "", confirm: "" });
  const [changingPassword, setChangingPassword] = useState(false);

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["mySettings"],
    queryFn: () => api.get("/settings/mine"),
    enabled: Boolean(accessToken),
  });

  useEffect(() => {
    const storedLanguage = window.localStorage.getItem("agriconnect-language");
    if (storedLanguage === "en" || storedLanguage === "ta" || storedLanguage === "hi") {
      setLanguage(storedLanguage);
      document.documentElement.lang = storedLanguage;
    }
  }, []);

  useEffect(() => {
    const saved = settingsData?.data;
    if (saved?.notifications) setNotifications((current) => ({ ...current, ...saved.notifications }));
    if (saved?.preferences) {
      const savedLanguage = saved.preferences.language || "en";
      const savedTheme = saved.preferences.theme || "system";
      setLanguage(savedLanguage);
      setTheme(savedTheme);
      document.documentElement.lang = savedLanguage;
      window.localStorage.setItem("agriconnect-language", savedLanguage);
    }
  }, [settingsData?.data]);

  const chooseLanguage = (value: string) => {
    setLanguage(value);
    document.documentElement.lang = value;
    window.localStorage.setItem("agriconnect-language", value);
  };

  const translations: Record<string, Record<string, string>> = {
    ta: {
      "Settings":"அமைப்புகள்","Manage your account, notifications, security, privacy and preferences.":"உங்கள் கணக்கு, அறிவிப்புகள், பாதுகாப்பு, தனியுரிமை மற்றும் விருப்பங்களை நிர்வகிக்கவும்.",
      "Notifications":"அறிவிப்புகள்","Security & Login":"பாதுகாப்பு & உள்நுழைவு","Privacy":"தனியுரிமை","Preferences":"விருப்பங்கள்","Payment Settings":"கட்டண அமைப்புகள்","Account Management":"கணக்கு மேலாண்மை",
      "Notification Preferences":"அறிவிப்பு விருப்பங்கள்","Choose what updates you want to receive from AgriConnect.":"AgriConnect இலிருந்து பெற விரும்பும் புதுப்பிப்புகளைத் தேர்ந்தெடுக்கவும்.",
      "Order Updates":"ஆர்டர் புதுப்பிப்புகள்","Order confirmation, preparation and dispatch updates.":"ஆர்டர் உறுதிப்படுத்தல், தயாரிப்பு மற்றும் அனுப்புதல் புதுப்பிப்புகள்.",
      "Delivery Updates":"விநியோக புதுப்பிப்புகள்","Pickup, partner assignment and out-for-delivery updates.":"எடுத்துச் செல்லுதல், கூட்டாளர் ஒதுக்கீடு மற்றும் விநியோக புதுப்பிப்புகள்.",
      "Payment Updates":"கட்டண புதுப்பிப்புகள்","Payment confirmation, failure and refund status.":"கட்டண உறுதிப்படுத்தல், தோல்வி மற்றும் பணத்திரும்பப் பெறுதல் நிலை.",
      "Return & Refunds":"திரும்பப்பெறுதல் & பணத்திரும்பப் பெறுதல்","Updates on return requests and refund processing.":"திரும்பப்பெறுதல் கோரிக்கைகள் மற்றும் பணத்திரும்பப் பெறுதல் புதுப்பிப்புகள்.",
      "Offers & Promotions":"சலுகைகள் & விளம்பரங்கள்","Deals, seasonal offers and personalized recommendations.":"சலுகைகள், பருவகால சலுகைகள் மற்றும் தனிப்பயன் பரிந்துரைகள்.",
      "Messages":"செய்திகள்","Messages from farmers, businesses and delivery partners.":"விவசாயிகள், வணிகங்கள் மற்றும் விநியோக கூட்டாளர்களிடமிருந்து செய்திகள்.",
      "Communication Channels":"தொடர்பு வழிகள்","Choose how you want to receive notifications.":"அறிவிப்புகளை எவ்வாறு பெற விரும்புகிறீர்கள் என்பதைத் தேர்ந்தெடுக்கவும்.",
      "Email":"மின்னஞ்சல்","Receive important updates via email.":"முக்கிய புதுப்பிப்புகளை மின்னஞ்சல் மூலம் பெறவும்.",
      "SMS":"குறுஞ்செய்தி","Receive order and delivery alerts via SMS.":"ஆர்டர் மற்றும் விநியோக அறிவிப்புகளை குறுஞ்செய்தி மூலம் பெறவும்.",
      "Push Notification":"புஷ் அறிவிப்பு","Get real-time updates in your browser or app.":"உங்கள் உலாவி அல்லது செயலியில் உடனடி புதுப்பிப்புகளைப் பெறவும்.",
      "Language":"மொழி","Appearance":"தோற்றம்","English":"ஆங்கிலம்","System":"கணினி அமைப்பு","Light":"ஒளி","Dark":"இருள்",
      "Keep your account safe and secure.":"உங்கள் கணக்கைப் பாதுகாப்பாக வைத்திருங்கள்.","Change Password":"கடவுச்சொல்லை மாற்றவும்","Update your account password.":"உங்கள் கணக்கு கடவுச்சொல்லைப் புதுப்பிக்கவும்.",
      "Current password":"தற்போதைய கடவுச்சொல்","New password (8+ characters)":"புதிய கடவுச்சொல் (குறைந்தது 8 எழுத்துகள்)","Confirm new password":"புதிய கடவுச்சொல்லை உறுதிப்படுத்தவும்","Update Password":"கடவுச்சொல்லைப் புதுப்பிக்கவும்",
      "Two-Factor Authentication (2FA)":"இரு-காரணி அங்கீகாரம் (2FA)","An extra layer of account security.":"கணக்கிற்கான கூடுதல் பாதுகாப்பு அடுக்கு.","Login Activity":"உள்நுழைவு செயல்பாடு","Recent device and login history.":"சமீபத்திய சாதனம் மற்றும் உள்நுழைவு வரலாறு.",
      "Control your data and privacy.":"உங்கள் தரவு மற்றும் தனியுரிமையைக் கட்டுப்படுத்தவும்.","Data & Privacy":"தரவு & தனியுரிமை","Manage how your account information is used.":"உங்கள் கணக்குத் தகவல் எவ்வாறு பயன்படுத்தப்படுகிறது என்பதை நிர்வகிக்கவும்.",
      "Profile Visibility":"சுயவிவரத் தெரிவுநிலை","Your contact details are shared only when needed for orders.":"ஆர்டர்களுக்குத் தேவைப்படும் போது மட்டுமே உங்கள் தொடர்பு விவரங்கள் பகிரப்படும்.",
      "Download My Data":"எனது தரவைப் பதிவிறக்கவும்","Data export is not available yet.":"தரவு ஏற்றுமதி இன்னும் கிடைக்கவில்லை.",
      "Manage your account and related services.":"உங்கள் கணக்கு மற்றும் தொடர்புடைய சேவைகளை நிர்வகிக்கவும்.","Personal Information":"தனிப்பட்ட தகவல்","Update your profile and saved addresses.":"உங்கள் சுயவிவரம் மற்றும் சேமித்த முகவரிகளைப் புதுப்பிக்கவும்.",
      "View payments, wallet and transaction history.":"கட்டணங்கள், பணப்பை மற்றும் பரிவர்த்தனை வரலாற்றைப் பார்க்கவும்.","Deactivate / Delete Account":"கணக்கை செயலிழக்கச் செய்யவும் / நீக்கவும்",
      "Your changes are applied when you save your settings.":"அமைப்புகளைச் சேமித்த பிறகு உங்கள் மாற்றங்கள் பயன்படுத்தப்படும்.","Save Settings":"அமைப்புகளைச் சேமிக்கவும்"
    },
    hi: {
      "Settings":"सेटिंग्स","Manage your account, notifications, security, privacy and preferences.":"अपना खाता, सूचनाएं, सुरक्षा, गोपनीयता और प्राथमिकताएं प्रबंधित करें।",
      "Notifications":"सूचनाएं","Security & Login":"सुरक्षा और लॉगिन","Privacy":"गोपनीयता","Preferences":"प्राथमिकताएं","Payment Settings":"भुगतान सेटिंग्स","Account Management":"खाता प्रबंधन",
      "Notification Preferences":"सूचना प्राथमिकताएं","Choose what updates you want to receive from AgriConnect.":"चुनें कि आप AgriConnect से कौन से अपडेट प्राप्त करना चाहते हैं।",
      "Order Updates":"ऑर्डर अपडेट","Order confirmation, preparation and dispatch updates.":"ऑर्डर पुष्टि, तैयारी और भेजने के अपडेट।",
      "Delivery Updates":"डिलीवरी अपडेट","Pickup, partner assignment and out-for-delivery updates.":"पिकअप, पार्टनर असाइनमेंट और डिलीवरी अपडेट।",
      "Payment Updates":"भुगतान अपडेट","Payment confirmation, failure and refund status.":"भुगतान पुष्टि, विफलता और रिफंड स्थिति।",
      "Return & Refunds":"वापसी और रिफंड","Updates on return requests and refund processing.":"वापसी अनुरोध और रिफंड प्रक्रिया के अपडेट।",
      "Offers & Promotions":"ऑफर और प्रचार","Deals, seasonal offers and personalized recommendations.":"डील, मौसमी ऑफर और व्यक्तिगत सुझाव।",
      "Messages":"संदेश","Messages from farmers, businesses and delivery partners.":"किसानों, व्यवसायों और डिलीवरी पार्टनर्स के संदेश।",
      "Communication Channels":"संचार माध्यम","Choose how you want to receive notifications.":"चुनें कि आप सूचनाएं कैसे प्राप्त करना चाहते हैं।",
      "Email":"ईमेल","Receive important updates via email.":"महत्वपूर्ण अपडेट ईमेल से प्राप्त करें।",
      "SMS":"एसएमएस","Receive order and delivery alerts via SMS.":"ऑर्डर और डिलीवरी अलर्ट एसएमएस से प्राप्त करें।",
      "Push Notification":"पुश सूचना","Get real-time updates in your browser or app.":"अपने ब्राउज़र या ऐप में तुरंत अपडेट प्राप्त करें।",
      "Language":"भाषा","Appearance":"दिखावट","English":"अंग्रेज़ी","System":"सिस्टम","Light":"लाइट","Dark":"डार्क",
      "Keep your account safe and secure.":"अपने खाते को सुरक्षित रखें।","Change Password":"पासवर्ड बदलें","Update your account password.":"अपने खाते का पासवर्ड अपडेट करें।",
      "Current password":"वर्तमान पासवर्ड","New password (8+ characters)":"नया पासवर्ड (8+ अक्षर)","Confirm new password":"नए पासवर्ड की पुष्टि करें","Update Password":"पासवर्ड अपडेट करें",
      "Two-Factor Authentication (2FA)":"दो-कारक प्रमाणीकरण (2FA)","An extra layer of account security.":"खाते की सुरक्षा की एक अतिरिक्त परत।","Login Activity":"लॉगिन गतिविधि","Recent device and login history.":"हाल के डिवाइस और लॉगिन इतिहास।",
      "Control your data and privacy.":"अपने डेटा और गोपनीयता को नियंत्रित करें।","Data & Privacy":"डेटा और गोपनीयता","Manage how your account information is used.":"प्रबंधित करें कि आपके खाते की जानकारी का उपयोग कैसे किया जाता है।",
      "Profile Visibility":"प्रोफ़ाइल दृश्यता","Your contact details are shared only when needed for orders.":"आपका संपर्क विवरण केवल ऑर्डर के लिए आवश्यक होने पर साझा किया जाता है।",
      "Download My Data":"मेरा डेटा डाउनलोड करें","Data export is not available yet.":"डेटा निर्यात अभी उपलब्ध नहीं है।",
      "Manage your account and related services.":"अपने खाते और संबंधित सेवाओं का प्रबंधन करें।","Personal Information":"व्यक्तिगत जानकारी","Update your profile and saved addresses.":"अपनी प्रोफ़ाइल और सहेजे गए पते अपडेट करें।",
      "View payments, wallet and transaction history.":"भुगतान, वॉलेट और लेनदेन इतिहास देखें।","Deactivate / Delete Account":"खाता निष्क्रिय / हटाएं",
      "Your changes are applied when you save your settings.":"आपकी सेटिंग्स सहेजने पर परिवर्तन लागू होंगे।","Save Settings":"सेटिंग्स सहेजें"
    }
  };
  const t = (value: string) => translations[language]?.[value] || value;

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
      <header className="relative w-full overflow-hidden rounded-[18px] border border-emerald-100 bg-white shadow-sm aspect-[8.63/1] min-h-[92px]">
        <img
          src="/images/settings-banner-exact.webp"
          alt="Settings — Manage your account, notifications, security, privacy and preferences."
          className="absolute inset-0 h-full w-full object-fill"
        />
      </header>
      <div className="flex justify-end">
        <Button
          onClick={saveSettings}
          disabled={saving}
          className="inline-flex shrink-0 items-center justify-center bg-emerald-700 px-5 text-white shadow-sm hover:bg-emerald-800"
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {t("Save Settings")}
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1.35fr)_minmax(300px,1fr)]">
        <nav className={panelClass + " h-fit p-2"} aria-label="Settings sections">
          {[
            { href: "#notifications", label: t("Notifications"), icon: Bell },
            { href: "#security", label: t("Security & Login"), icon: ShieldCheck },
            { href: "#privacy", label: t("Privacy"), icon: LockKeyhole },
            { href: "#preferences", label: t("Preferences"), icon: SlidersHorizontal },
            { href: "#payments", label: t("Payment Settings"), icon: CreditCard },
            { href: "#account", label: t("Account Management"), icon: User },
          ].map(({ href, label, icon: Icon }, index) => (
            <a key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition hover:bg-emerald-50 hover:text-emerald-800 ${index === 0 ? "bg-emerald-100 text-emerald-800" : "text-slate-700"}`}>
              <Icon className="h-5 w-5" />{label}
            </a>
          ))}
        </nav>

        <section id="notifications" className={panelClass + " scroll-mt-5 p-4 sm:p-5"}>
          <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3">
            <div className={iconBubble}><Bell className="h-6 w-6" /></div>
            <div><h2 className="text-lg font-bold text-slate-950">{t("Notification Preferences")}</h2><p className="text-xs text-slate-600">{t("Choose what updates you want to receive from AgriConnect.")}</p></div>
          </div>
          <div className="divide-y divide-slate-100">
            {NOTIFICATION_ITEMS.map(({ key, label, description, icon: Icon }) => (
              <div key={key} className="flex items-center gap-3 py-3">
                <div className={iconBubble}><Icon className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-900">{t(label)}</p><p className="text-xs leading-5 text-slate-600">{t(description)}</p></div>
                <SettingsToggle checked={Boolean(notifications[key])} onChange={(checked) => setNotifications((current) => ({ ...current, [key]: checked }))} label={`Toggle ${label}`} />
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-3">
          <section className={panelClass + " p-4"}>
            <div className="mb-2 flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className={iconBubble}><Send className="h-5 w-5" /></div>
              <div><h2 className="text-lg font-bold text-slate-950">{t("Communication Channels")}</h2><p className="text-xs text-slate-600">{t("Choose how you want to receive notifications.")}</p></div>
            </div>
            {CHANNEL_ITEMS.map(({ key, label, description, icon: Icon }) => (
              <div key={key} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-0">
                <SettingsToggle checked={Boolean(notifications[key])} onChange={(checked) => setNotifications((current) => ({ ...current, [key]: checked }))} label={`Enable ${label}`} />
                <Icon className="h-5 w-5 text-emerald-700" />
                <div className="min-w-0"><p className="text-sm font-bold text-slate-900">{t(label)}</p><p className="text-xs text-slate-600">{t(description)}</p></div>
              </div>
            ))}
          </section>

          <section id="preferences" className={panelClass + " scroll-mt-5 p-4"}>
            <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3"><div className={iconBubble}><SlidersHorizontal className="h-5 w-5" /></div><h2 className="text-lg font-bold text-slate-950">{t("Preferences")}</h2></div>
            <div className="space-y-3">
              <div><p className="mb-2 text-sm font-bold text-slate-900">{t("Language")}</p><div className="grid grid-cols-3 gap-2">
                {[["en","English"],["ta","தமிழ் (Tamil)"],["hi","हिंदी (Hindi)"]].map(([value,label]) => <button key={value} type="button" onClick={() => chooseLanguage(value)} className={`rounded-lg border px-2 py-2 text-xs font-semibold ${language === value ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>{language === value ? "● " : "○ "}{t(label)}</button>)}
              </div></div>
              <div><p className="mb-2 text-sm font-bold text-slate-900">{t("Appearance")}</p><div className="grid grid-cols-3 gap-2">
                {[["system","System",Monitor],["light","Light",Sun],["dark","Dark",Moon]].map(([value,label,Icon]: any) => <button key={value} type="button" onClick={() => setTheme(value)} className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold ${theme === value ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}><Icon className="h-4 w-4" />{label}</button>)}
              </div></div>
            </div>
          </section>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <section id="security" className={panelClass + " scroll-mt-5 p-4"}>
          <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3"><div className={iconBubble}><ShieldCheck className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-slate-950">{t("Security & Login")}</h2><p className="text-xs text-slate-600">{t("Keep your account safe and secure.")}</p></div></div>
          <div className="space-y-3">
            <div className="flex items-center gap-3"><div className={iconBubble}><KeyRound className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">{t("Change Password")}</p><p className="text-xs text-slate-600">{t("Update your account password.")}</p></div></div>
            <div className="grid gap-2">
              <Input type="password" value={pwFields.current} onChange={(e) => setPwFields((v) => ({ ...v, current: e.target.value }))} placeholder={t("Current password")} aria-label="Current password" />
              <Input type="password" value={pwFields.next} onChange={(e) => setPwFields((v) => ({ ...v, next: e.target.value }))} placeholder={t("New password (8+ characters)")} aria-label="New password" />
              <Input type="password" value={pwFields.confirm} onChange={(e) => setPwFields((v) => ({ ...v, confirm: e.target.value }))} placeholder={t("Confirm new password")} aria-label="Confirm new password" />
              <Button onClick={changePassword} disabled={changingPassword} size="sm" className="w-fit">{changingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update Password</Button>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3"><div><p className="text-sm font-bold">{t("Two-Factor Authentication (2FA)")}</p><p className="text-xs text-slate-600">{t("An extra layer of account security.")}</p></div><span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">Not enabled</span></div>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3"><div><p className="text-sm font-bold">{t("Login Activity")}</p><p className="text-xs text-slate-600">{t("Recent device and login history.")}</p></div><span className="text-[10px] text-slate-500">Coming soon</span></div>
          </div>
        </section>

        <section id="privacy" className={panelClass + " scroll-mt-5 p-4"}>
          <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3"><div className={iconBubble}><LockKeyhole className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-slate-950">{t("Privacy")}</h2><p className="text-xs text-slate-600">{t("Control your data and privacy.")}</p></div></div>
          <div className="space-y-3">
            <div className="flex items-center gap-3"><div className={iconBubble}><Database className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">{t("Data & Privacy")}</p><p className="text-xs text-slate-600">{t("Manage how your account information is used.")}</p></div><ChevronRight className="h-4 w-4 text-slate-400" /></div>
            <div className="flex items-center gap-3 border-t border-slate-100 pt-3"><div className={iconBubble}><Eye className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">{t("Profile Visibility")}</p><p className="text-xs text-slate-600">{t("Your contact details are shared only when needed for orders.")}</p></div></div>
            <div className="flex items-center gap-3 border-t border-slate-100 pt-3"><div className={iconBubble}><Download className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">{t("Download My Data")}</p><p className="text-xs text-slate-600">{t("Data export is not available yet.")}</p></div><span className="text-[10px] text-slate-500">Coming soon</span></div>
          </div>
        </section>

        <section id="account" className={panelClass + " scroll-mt-5 p-4"}>
          <div className="mb-3 flex items-center gap-3 border-b border-slate-100 pb-3"><div className={iconBubble}><User className="h-5 w-5" /></div><div><h2 className="text-lg font-bold text-slate-950">{t("Account Management")}</h2><p className="text-xs text-slate-600">{t("Manage your account and related services.")}</p></div></div>
          <div className="space-y-3">
            <Link href="/profile" className="flex items-center gap-3"><div className={iconBubble}><User className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">{t("Personal Information")}</p><p className="text-xs text-slate-600">{t("Update your profile and saved addresses.")}</p></div><ChevronRight className="h-4 w-4 text-slate-400" /></Link>
            <Link href="/payments" className="flex items-center gap-3 border-t border-slate-100 pt-3"><div className={iconBubble}><CreditCard className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">{t("Payment Settings")}</p><p className="text-xs text-slate-600">{t("View payments, wallet and transaction history.")}</p></div><ChevronRight className="h-4 w-4 text-slate-400" /></Link>
            <div className="flex items-center gap-3 border-t border-slate-100 pt-3"><div className={iconBubble}><PauseCircle className="h-5 w-5" /></div><div className="flex-1"><p className="text-sm font-bold">{t("Deactivate / Delete Account")}</p><p className="text-xs text-slate-600">{t("Contact support to request account closure.")}</p></div><span className="text-[10px] text-slate-500">Support</span></div>
          </div>
        </section>
      </div>

    </div>
  );
}
