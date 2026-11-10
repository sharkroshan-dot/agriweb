"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap,
  BookOpen,
  Sprout,
  IndianRupee,
  ShoppingBag,
  Package,
  FlaskConical,
  Snowflake,
  Landmark,
  TrendingUp,
  Search,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";

const TOPICS = [
  { id: "crop", name: "Crop Management", icon: Sprout, color: "text-emerald-600 bg-emerald-50" },
  { id: "pricing", name: "Pricing", icon: IndianRupee, color: "text-blue-600 bg-blue-50" },
  { id: "selling", name: "Digital Selling", icon: ShoppingBag, color: "text-purple-600 bg-purple-50" },
  { id: "packaging", name: "Packaging", icon: Package, color: "text-amber-600 bg-amber-50" },
  { id: "quality", name: "Quality", icon: FlaskConical, color: "text-red-600 bg-red-50" },
  { id: "storage", name: "Storage", icon: Snowflake, color: "text-cyan-600 bg-cyan-50" },
  { id: "schemes", name: "Government Schemes", icon: Landmark, color: "text-indigo-600 bg-indigo-50" },
  { id: "trends", name: "Market Trends", icon: TrendingUp, color: "text-teal-600 bg-teal-50" },
];

const RESOURCES = [
  { id: "icar-crop", topic: "crop", title: "ICAR crop management knowledge resources", type: "Official resource", readTime: "Reference", level: "All levels", description: "Crop-specific production guidance, expert systems and agricultural knowledge resources from ICAR.", source: "ICAR", url: "https://icar.gov.in/en/technologies-and-knowledge-resources" },
  { id: "icar-publications", topic: "crop", title: "ICAR agricultural publications", type: "Publication", readTime: "Reference", level: "All levels", description: "Agriculture, horticulture, soil, pest management, crop production and other farmer-relevant publications.", source: "ICAR", url: "https://www.icar.gov.in/en/all-publications" },
  { id: "icar-advisory", topic: "crop", title: "ICAR agro-advisories for farmers", type: "Advisory", readTime: "Reference", level: "All levels", description: "Seasonal agro-advisory material, including regional-language editions.", source: "ICAR", url: "https://icar.gov.in/en/icar-kharif-agro-advisories-farmers-2025-regional-languages-edition-1" },
  { id: "postharvest", topic: "storage", title: "Post-harvest management and processing", type: "Publication", readTime: "Reference", level: "Intermediate", description: "Guidance covering preservation, post-harvest diseases, storage and processing of fruits and vegetables.", source: "ICAR", url: "https://www.icar.gov.in/en/all-publications" },
  { id: "quality", topic: "quality", title: "Produce quality and grading", type: "Guide", readTime: "Practical", level: "Beginner", description: "Learn how quality, grading, safe handling and post-harvest practices affect produce value.", source: "AgriConnect + ICAR", url: "https://www.icar.gov.in/en/all-publications" },
  { id: "storage", topic: "storage", title: "Storage, cold-chain and preservation", type: "Guide", readTime: "Practical", level: "Beginner", description: "Understand preservation, storage and cold-chain principles for reducing post-harvest losses.", source: "AgriConnect + ICAR", url: "https://www.icar.gov.in/en/all-publications" },
  { id: "pricing", topic: "pricing", title: "Pricing and market decisions", type: "Guide", readTime: "Practical", level: "Intermediate", description: "Use current marketplace information in AgriConnect together with official agricultural knowledge when deciding how to sell.", source: "AgriConnect", url: "/farmer/market-prices" },
  { id: "selling", topic: "selling", title: "Digital selling and repeat customers", type: "Guide", readTime: "Practical", level: "Beginner", description: "Learn product listing, customer communication, order handling, fulfilment and repeat-sales practices.", source: "AgriConnect", url: "/farmer/products" },
  { id: "packaging", topic: "packaging", title: "Packaging and fulfilment", type: "Guide", readTime: "Practical", level: "Beginner", description: "Choose packaging and handling practices appropriate to the produce and delivery journey.", source: "AgriConnect + ICAR", url: "https://www.icar.gov.in/en/all-publications" },
  { id: "schemes", topic: "schemes", title: "PM-KISAN: registration, status and farmer services", type: "Government", readTime: "Official portal", level: "All levels", description: "Official PM-KISAN information including registration, beneficiary status, eKYC, guidelines and farmer services.", source: "Government of India", url: "https://www.pmkisan.gov.in/" },
  { id: "schemes-kcc", topic: "schemes", title: "Kisan Credit Card and agriculture finance resources", type: "Government", readTime: "Official portal", level: "All levels", description: "Use official government resources to understand available agriculture finance and KCC-related services.", source: "Government of India", url: "https://www.pmkisan.gov.in/" },
  { id: "trends", topic: "trends", title: "Market trends and demand signals", type: "Dashboard", readTime: "Live data", level: "All levels", description: "Use AgriConnect market, order and demand information to understand selling opportunities and plan production.", source: "AgriConnect", url: "/farmer/market-prices" },
];

const SOURCE_GROUPS: Record<string, { name: string; description: string; links: { title: string; source: string; url: string; kind: string }[] }> = {
  crop: { name: "Crop Management", description: "Crop production, crop protection, varieties, soil, irrigation and seasonal advisories.", links: [
    { title: "TNAU AgriTech crop guides", source: "Tamil Nadu Agricultural University", url: "https://agritech.tnau.ac.in/", kind: "Crop guide" },
    { title: "ICAR knowledge resources", source: "ICAR", url: "https://www.icar.gov.in/en/technologies-and-knowledge-resources", kind: "Official" },
    { title: "ICAR farmer advisories", source: "ICAR", url: "https://icar.gov.in/en/icar-kharif-agro-advisories-farmers-2025", kind: "Advisory" },
    { title: "ICAR publications", source: "ICAR", url: "https://www.icar.gov.in/en/all-publications", kind: "Publication" },
  ]},
  pricing: { name: "Pricing & Market Decisions", description: "Market information, price discovery, mandi learning and digital agricultural markets.", links: [
    { title: "e-NAM learning", source: "National Agriculture Market", url: "https://elearning.enam.gov.in/local/staticpage/view.php?page=guest", kind: "e-Learning" },
    { title: "e-NAM resources", source: "National Agriculture Market", url: "https://enam.gov.in/resources", kind: "Guides" },
    { title: "e-NAM dashboard", source: "National Agriculture Market", url: "https://enam.gov.in/dashboard", kind: "Market data" },
    { title: "TNAU agricultural marketing", source: "Tamil Nadu Agricultural University", url: "https://agritech.tnau.ac.in/", kind: "Reference" },
  ]},
  selling: { name: "Digital Selling", description: "Learn digital marketplace participation, online trading and customer-oriented selling.", links: [
    { title: "e-NAM seller learning", source: "National Agriculture Market", url: "https://elearning.enam.gov.in/local/staticpage/view.php?page=guest", kind: "e-Learning" },
    { title: "e-NAM registration & manuals", source: "National Agriculture Market", url: "https://enam.gov.in/resources", kind: "Official" },
    { title: "AgriConnect Products", source: "AgriConnect", url: "/farmer/products", kind: "Practice" },
  ]},
  packaging: { name: "Packaging & Post-Harvest", description: "Harvest handling, preservation, grading, packaging, storage, processing and loss reduction.", links: [
    { title: "ICAR post-harvest publications", source: "ICAR", url: "https://www.icar.gov.in/en/all-publications", kind: "Publication" },
    { title: "TNAU post-harvest technology", source: "Tamil Nadu Agricultural University", url: "https://agritech.tnau.ac.in/", kind: "Reference" },
    { title: "ICAR farmer advisories", source: "ICAR", url: "https://icar.gov.in/en/icar-kharif-agro-advisories-farmers-2025", kind: "Advisory" },
  ]},
  quality: { name: "Quality & Grading", description: "Quality assessment, grading, food safety and market-quality practices.", links: [
    { title: "e-NAM quality resources", source: "National Agriculture Market", url: "https://enam.gov.in/resources", kind: "Guides" },
    { title: "ICAR agricultural publications", source: "ICAR", url: "https://www.icar.gov.in/en/all-publications", kind: "Publication" },
    { title: "TNAU food safety & quality resources", source: "Tamil Nadu Agricultural University", url: "https://agritech.tnau.ac.in/", kind: "Reference" },
  ]},
  storage: { name: "Storage & Cold Chain", description: "Storage, preservation, cold-chain concepts and post-harvest disease management.", links: [
    { title: "ICAR post-harvest management publications", source: "ICAR", url: "https://www.icar.gov.in/en/all-publications", kind: "Publication" },
    { title: "TNAU post-harvest technology", source: "Tamil Nadu Agricultural University", url: "https://agritech.tnau.ac.in/", kind: "Reference" },
  ]},
  schemes: { name: "Government Schemes & Finance", description: "Official scheme information, farmer services, KCC and government agricultural support.", links: [
    { title: "PM-KISAN official portal", source: "Government of India", url: "https://www.pmkisan.gov.in/", kind: "Official" },
    { title: "PM-KISAN farmer services", source: "Government of India", url: "https://www.pmkisan.gov.in/", kind: "Registration & status" },
    { title: "TNAU schemes & services", source: "Tamil Nadu Agricultural University", url: "https://agritech.tnau.ac.in/", kind: "State reference" },
  ]},
  trends: { name: "Market Trends & Demand", description: "Market signals, commodity information, demand context and planning references.", links: [
    { title: "e-NAM dashboard", source: "National Agriculture Market", url: "https://enam.gov.in/dashboard", kind: "Market data" },
    { title: "e-NAM commodity list", source: "National Agriculture Market", url: "https://enam.gov.in/commodity/commodity-list", kind: "Commodity reference" },
    { title: "AgriConnect market prices", source: "AgriConnect", url: "/farmer/market-prices", kind: "Practice" },
  ]},
};
export default function FarmerEducationPage() {
  const [search, setSearch] = useState("");
  const [activeTopic, setActiveTopic] = useState<string>("all");
  const [selectedResource, setSelectedResource] = useState<any | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    try {
      setSavedIds(JSON.parse(localStorage.getItem("farmerEducation:saved") || "[]"));
      setCompletedIds(JSON.parse(localStorage.getItem("farmerEducation:completed") || "[]"));
    } catch {
      setSavedIds([]);
      setCompletedIds([]);
    }
  }, []);

  const toggleSaved = (id: string) => {
    const next = savedIds.includes(id) ? savedIds.filter((x) => x !== id) : [...savedIds, id];
    setSavedIds(next);
    localStorage.setItem("farmerEducation:saved", JSON.stringify(next));
  };

  const markCompleted = (id: string) => {
    if (completedIds.includes(id)) return;
    const next = [...completedIds, id];
    setCompletedIds(next);
    localStorage.setItem("farmerEducation:completed", JSON.stringify(next));
  };

  const { data: educationData, isLoading, isError, refetch } = useQuery({
    queryKey: ["farmerEducation"],
    queryFn: () => api.get("/education/resources"),
    retry: 1,
  });

  const apiResources = useMemo(() => {
    const list = educationData?.data?.resources || educationData?.data || [];
    if (Array.isArray(list) && list.length > 0) return list;
    return RESOURCES;
  }, [educationData]);

  const filtered = apiResources.filter((r: any) => {
    const topicMatch = activeTopic === "all" || r.topic === activeTopic;
    const searchMatch =
      !search.trim() ||
      (r.title || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.type || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.description || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.source || "").toLowerCase().includes(search.toLowerCase());
    const id = String(r.id || r.title);
    const savedMatch = !showSaved || savedIds.includes(id);
    return topicMatch && searchMatch && savedMatch;
  });

  const topicInfo = (topic: string) => TOPICS.find((t) => t.id === topic);
  const learningProgress = apiResources.length
    ? Math.round((completedIds.filter((id) => apiResources.some((r: any) => String(r.id) === id)).length / apiResources.length) * 100)
    : 0;
  const resourceDescription = (r: any) =>
    r.description ||
    `A practical ${String(r.type || "learning resource").toLowerCase()} for farmers covering ${topicInfo(r.topic)?.name?.toLowerCase() || "farm management"} with simple, actionable steps.`;


  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <section className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/80 to-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800"><GraduationCap className="h-6 w-6" /></div>
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Farmer learning library</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Education Center</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Practical guides and trusted agricultural resources to help you grow, handle, price and sell your produce with confidence.</p></div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[230px]">
            <div className="rounded-xl border border-white bg-white/90 p-3"><p className="text-xs text-slate-500">Resources</p><p className="mt-1 text-xl font-semibold text-slate-900">{apiResources.length}</p></div>
            <div className="rounded-xl border border-white bg-white/90 p-3"><p className="text-xs text-slate-500">Completed</p><p className="mt-1 text-xl font-semibold text-slate-900">{completedIds.length}</p></div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Your learning progress</h2><p className="mt-1 text-sm text-slate-500">Track the resources you have completed.</p></div><span className="text-2xl font-bold text-emerald-700">{learningProgress}%</span></div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: learningProgress + "%" }} /></div>
          <div className="mt-2 flex justify-between text-xs text-slate-500"><span>{completedIds.length} completed</span><span>{Math.max(0, apiResources.length - completedIds.length)} remaining</span></div>
        </CardContent></Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex h-full items-center justify-between p-4 sm:p-5">
          <div><p className="text-sm font-medium text-slate-700">Saved for later</p><p className="mt-1 text-2xl font-bold text-slate-900">{savedIds.length}</p><p className="mt-1 text-xs text-slate-500">Your personal reading list</p></div>
          <button type="button" onClick={() => { setShowSaved((v) => !v); setActiveTopic("all"); }} className={cn("rounded-lg border px-3 py-2 text-sm font-medium transition-colors", showSaved ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>{showSaved ? "View all" : "View saved"}</button>
        </CardContent></Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-lg font-semibold text-slate-900">{showSaved ? "Your saved resources" : "Explore learning resources"}</h2><p className="text-sm text-slate-500">Search by topic, resource name or source.</p></div>
          <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search learning resources..." className="h-10 rounded-xl border-slate-200 bg-white pl-9" /></div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setActiveTopic("all")} className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors", activeTopic === "all" ? "bg-emerald-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>All topics</button>
          {TOPICS.map((topic) => <button key={topic.id} type="button" onClick={() => setActiveTopic(topic.id)} className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors", activeTopic === topic.id ? "bg-emerald-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{topic.name}</button>)}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[1,2,3,4,5,6].map((n) => <div key={n} className="h-48 animate-pulse rounded-2xl bg-slate-100" />)}</div>
        ) : isError ? (
          <Card className="rounded-2xl border-red-200 bg-red-50/40 shadow-none"><CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center"><div><p className="font-semibold text-slate-900">Learning resources could not be refreshed</p><p className="mt-1 text-sm text-slate-600">Retry loading the latest resources. Built-in learning resources may still be available.</p></div><button type="button" onClick={() => refetch()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white">Try again</button></CardContent></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((resource: any) => {
              const topic = topicInfo(resource.topic);
              const Icon = topic?.icon || BookOpen;
              const id = String(resource.id || resource.title);
              const isSaved = savedIds.includes(id);
              const isCompleted = completedIds.includes(id);
              return (
                <Card key={id} className="flex h-full flex-col rounded-2xl border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
                  <CardHeader className="flex-1 space-y-3 pb-3">
                    <div className="flex items-center justify-between gap-2"><div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", topic?.color || "bg-slate-100 text-slate-600")}><Icon className="h-5 w-5" /></div><div className="flex flex-wrap justify-end gap-1.5">{isCompleted && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">Completed</Badge>}<Badge variant="outline" className="border-slate-200 text-slate-600">{resource.level || "All levels"}</Badge></div></div>
                    <div><p className="text-xs font-medium text-emerald-700">{topic?.name || "Farmer learning"}</p><CardTitle className="mt-1 text-base leading-6 text-slate-900">{resource.title}</CardTitle><CardDescription className="mt-2 line-clamp-3 text-sm leading-5">{resource.description || resourceDescription(resource)}</CardDescription></div>
                  </CardHeader>
                  <CardContent className="mt-auto space-y-3 pt-0">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span className="inline-flex items-center gap-1.5">{resource.type === "Video" ? <PlayCircle className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}{resource.type || "Learning resource"}</span><span>{resource.readTime || "Reference"}</span></div>
                    <div className="flex gap-2"><button type="button" onClick={() => setSelectedResource(resource)} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800">View resource</button><button type="button" aria-label={isSaved ? "Remove saved resource" : "Save resource"} onClick={() => toggleSaved(id)} className={cn("rounded-lg border px-3 py-2.5 text-sm font-medium", isSaved ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>{isSaved ? "Saved" : "Save"}</button></div>
                  </CardContent>
                </Card>
              );
            })}
            {filtered.length === 0 && <Card className="rounded-2xl border-dashed border-slate-300 bg-slate-50/50 shadow-none sm:col-span-2 xl:col-span-3"><CardContent className="py-12 text-center"><BookOpen className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-semibold text-slate-800">{showSaved ? "No saved resources yet" : "No matching resources found"}</p><p className="mt-1 text-sm text-slate-500">{showSaved ? "Save a guide to keep it here for quick access." : "Try another search term or choose a different topic."}</p>{(search || activeTopic !== "all" || showSaved) && <button type="button" onClick={() => { setSearch(""); setActiveTopic("all"); setShowSaved(false); }} className="mt-4 text-sm font-semibold text-emerald-700 hover:text-emerald-800">Clear filters</button>}</CardContent></Card>}
          </div>
        )}
      </section>

      {selectedResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="education-resource-title">
          <Card className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-slate-200 shadow-xl">
            <CardHeader className="border-b border-slate-100 pb-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><Badge variant="outline">{selectedResource.type || "Learning resource"}</Badge><CardTitle id="education-resource-title" className="mt-3 text-xl leading-7 text-slate-900">{selectedResource.title}</CardTitle><CardDescription className="mt-2">{topicInfo(selectedResource.topic)?.name || "Farmer learning"} · {selectedResource.level || "All levels"} · {selectedResource.source || "AgriConnect"}</CardDescription></div><button type="button" onClick={() => setSelectedResource(null)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Close</button></div></CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{resourceDescription(selectedResource)}</div>
              <p className="text-xs text-slate-500">This resource opens the original provider or the related AgriConnect page. Follow the source instructions and local agricultural guidance for crop-specific decisions.</p>
              {selectedResource.url && <a href={selectedResource.url} target={selectedResource.url.startsWith("http") ? "_blank" : undefined} rel={selectedResource.url.startsWith("http") ? "noreferrer" : undefined} className="inline-flex items-center justify-center rounded-lg border border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-50">{selectedResource.url.startsWith("http") ? "Open official learning source" : "Open in AgriConnect"}</a>}
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => { markCompleted(String(selectedResource.id || selectedResource.title)); setSelectedResource(null); }} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">Mark as completed</button><button type="button" onClick={() => toggleSaved(String(selectedResource.id || selectedResource.title))} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">{savedIds.includes(String(selectedResource.id || selectedResource.title)) ? "Remove from saved" : "Save for later"}</button></div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
