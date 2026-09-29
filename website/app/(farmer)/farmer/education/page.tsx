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
  { id: "r1", topic: "quality", title: "How to grade your harvest like a pro", type: "Article", readTime: "5 min", level: "Beginner" },
  { id: "r2", topic: "storage", title: "Cold-chain basics: keeping produce fresh longer", type: "Video", readTime: "8 min", level: "Beginner" },
  { id: "r3", topic: "pricing", title: "Reading market prices to price your produce", type: "Article", readTime: "6 min", level: "Intermediate" },
  { id: "r4", topic: "schemes", title: "PM-KISAN & other schemes you may be eligible for", type: "Guide", readTime: "10 min", level: "Beginner" },
  { id: "r5", topic: "selling", title: "Using the marketplace to get repeat customers", type: "Video", readTime: "7 min", level: "Intermediate" },
  { id: "r6", topic: "packaging", title: "Cheap, eco-friendly packaging for farm produce", type: "Article", readTime: "4 min", level: "Beginner" },
];

export default function FarmerEducationPage() {
  const [search, setSearch] = useState("");
  const [activeTopic, setActiveTopic] = useState<string>("all");
  const [selectedResource, setSelectedResource] = useState<any | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [completedIds, setCompletedIds] = useState<string[]>([]);

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

  const { data: educationData } = useQuery({
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
      (r.type || "").toLowerCase().includes(search.toLowerCase());
    return topicMatch && searchMatch;
  });

  const topicInfo = (topic: string) => TOPICS.find((t) => t.id === topic);
  const learningProgress = apiResources.length
    ? Math.round((completedIds.filter((id) => apiResources.some((r: any) => String(r.id) === id)).length / apiResources.length) * 100)
    : 0;
  const resourceDescription = (r: any) =>
    r.description ||
    `A practical ${String(r.type || "learning resource").toLowerCase()} for farmers covering ${topicInfo(r.topic)?.name?.toLowerCase() || "farm management"} with simple, actionable steps.`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Farmer Education Center</h1>
        <p className="text-gray-500">Learn to grow smarter, price better, and sell more — in simple language.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2 border-emerald-100 bg-emerald-50/60">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-emerald-800">My Learning</p>
                <p className="mt-1 text-2xl font-bold text-emerald-950">{completedIds.length} completed</p>
                <p className="text-xs text-emerald-700">Keep learning to improve crop, selling and post-harvest decisions.</p>
              </div>
              <GraduationCap className="h-10 w-10 text-emerald-600" />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100">
              <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${learningProgress}%` }} />
            </div>
            <p className="mt-2 text-xs text-emerald-700">{learningProgress}% progress across available resources</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-gray-500">Saved resources</p>
            <p className="mt-1 text-2xl font-bold">{savedIds.length}</p>
            <p className="text-xs text-gray-500">Quick access to resources you want to revisit.</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resources..." className="pl-9" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTopic("all")}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-medium transition-colors",
            activeTopic === "all" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          )}
        >
          All topics
        </button>
        {TOPICS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTopic(t.id)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              activeTopic === t.id ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {t.name}
          </button>
        ))}
      </div>

      {activeTopic !== "all" && (
        <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-emerald-50">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-sm text-violet-900">
              AI pick for you: "You grow produce that needs careful handling. Start with{" "}
              <span className="font-semibold">how to grade your harvest</span> and{" "}
              <span className="font-semibold">cold-chain basics</span>."
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r: any) => {
          const topic = topicInfo(r.topic);
          const Icon = topic?.icon || BookOpen;
          return (
            <Card key={r.id || r.title} className="cursor-pointer transition-shadow hover:shadow-md">
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", topic?.color)}>
                    <Icon className="h-4.5 w-4.5 h-5 w-5" />
                  </div>
                  <Badge variant="outline">{r.level}</Badge>
                </div>
                <CardTitle className="text-base leading-snug">{r.title}</CardTitle>
                <CardDescription className="flex items-center gap-2">
                  {r.type === "Video" ? <PlayCircle className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                  {r.type} · {r.readTime}
                </CardDescription>
              </CardHeader>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="py-10 text-center text-sm text-gray-400">
              No resources found for that topic. Check back soon.
            </CardContent>
          </Card>
        )}
      </div>

      {selectedResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Badge variant="outline">{selectedResource.type || "Resource"}</Badge>
                  <CardTitle className="mt-3 text-xl">{selectedResource.title}</CardTitle>
                  <CardDescription className="mt-2">
                    {topicInfo(selectedResource.topic)?.name || "Farmer learning"} · {selectedResource.readTime || "Practical guide"}
                  </CardDescription>
                </div>
                <button type="button" onClick={() => setSelectedResource(null)} className="rounded-md border px-3 py-1 text-sm text-gray-600">Close</button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg bg-gray-50 p-4 text-sm leading-6 text-gray-700">{resourceDescription(selectedResource)}</div>
              <div>
                <h3 className="font-semibold">What you will learn</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                  <li>Key practices and decisions for this topic.</li>
                  <li>Simple steps you can apply on your farm.</li>
                  <li>Common mistakes to avoid and when to seek expert help.</li>
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { markCompleted(String(selectedResource.id || selectedResource.title)); setSelectedResource(null); }}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Mark as completed
                </button>
                <button
                  type="button"
                  onClick={() => toggleSaved(String(selectedResource.id || selectedResource.title))}
                  className="rounded-md border px-4 py-2 text-sm font-medium"
                >
                  {savedIds.includes(String(selectedResource.id || selectedResource.title)) ? "Remove from saved" : "Save for later"}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-5 w-5 text-emerald-600" />
            Personalized learning
          </CardTitle>
          <CardDescription>
            As you add crops, the education center will recommend resources matched to your current crop stage, season, and location.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}