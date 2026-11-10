"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Bookmark, Bot, CheckCircle2, ChevronRight, ClipboardCheck, Clock3, GraduationCap, Languages, Loader2, PlayCircle, Search, Sprout, X } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";

type Lesson = { id: string; title: string; summary?: string; content: string; order: number; estimatedMinutes?: number; actionTasks?: string[]; sourceName?: string; sourceUrl?: string; videoUrl?: string };
type Course = { id: string; title: string; description: string; category: string; level: string; estimatedMinutes: number; lessonCount: number; lessons: Lesson[] };
const LANGUAGES = [{ value: "en", label: "English" }, { value: "ta", label: "தமிழ்" }, { value: "hi", label: "हिन्दी" }];

export default function FarmerEducationPage() {
  const qc = useQueryClient();
  const [language, setLanguage] = useState("en");
  const [learningLevel, setLearningLevel] = useState("Beginner");
  const [interests, setInterests] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantReply, setAssistantReply] = useState<any>(null);
  const [showSaved, setShowSaved] = useState(false);

  const catalogQuery = useQuery({ queryKey: ["educationCatalog", language], queryFn: () => api.get("/education/catalog", { params: { language } }) });
  const dashboardQuery = useQuery({ queryKey: ["educationDashboard"], queryFn: () => api.get("/education/me/dashboard") });
  const recommendationQuery = useQuery({ queryKey: ["educationRecommendations"], queryFn: () => api.get("/education/me/recommendations") });
  const preferencesQuery = useQuery({ queryKey: ["educationPreferences"], queryFn: () => api.get("/education/me/preferences") });
  const conversationQuery = useQuery({ queryKey: ["educationConversation"], queryFn: () => api.get("/education/me/conversation") });

  const catalog = catalogQuery.data?.data ?? catalogQuery.data ?? {};
  const courses: Course[] = catalog.courses ?? [];
  const dashboard = dashboardQuery.data?.data ?? dashboardQuery.data ?? {};
  const completedIds: string[] = dashboard.completedLessonIds ?? [];
  const inProgress: any[] = dashboard.inProgress ?? [];
  const savedIds: string[] = dashboard.savedResourceIds ?? [];
  const plans: any[] = dashboard.actionPlans ?? [];
  const certificates: any[] = dashboard.certificates ?? [];
  const categories = ["All", ...Array.from(new Set(courses.map((course) => course.category)))];

  const filteredCourses = useMemo(() => courses.filter((course) => {
    const matchesCategory = category === "All" || course.category === category;
    const text = [course.title, course.description, course.category].join(" ").toLowerCase();
    const matchesSearch = !search.trim() || text.includes(search.trim().toLowerCase());
    const matchesSaved = !showSaved || savedIds.includes(course.id);
    return matchesCategory && matchesSearch && matchesSaved;
  }), [courses, category, search, showSaved, savedIds]);

  const progressMutation = useMutation({
    mutationFn: (body: any) => api.post("/education/me/progress", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["educationDashboard"] }),
  });
  const savedMutation = useMutation({
    mutationFn: (body: any) => api.post("/education/me/saved", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["educationDashboard"] }),
  });
  const actionMutation = useMutation({
    mutationFn: (body: any) => api.post("/education/me/action-plans", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["educationDashboard"] }),
  });
  const taskMutation = useMutation({ mutationFn: ({ planId, taskId, completed }: any) => api.patch("/education/me/action-plans/" + planId + "/tasks/" + taskId, { completed }), onSuccess: () => qc.invalidateQueries({ queryKey: ["educationDashboard"] }) });
  const preferencesMutation = useMutation({ mutationFn: (body:any) => api.put("/education/me/preferences", body), onSuccess: () => qc.invalidateQueries({ queryKey: ["educationPreferences"] }) });
  const assistantMutation = useMutation({
    mutationFn: (body: any) => api.post("/education/assistant", body),
    onSuccess: (response) => { setAssistantReply(response?.data ?? response); qc.invalidateQueries({ queryKey: ["educationConversation"] }); },
  });

  useEffect(() => {
    const prefs = preferencesQuery.data?.data ?? preferencesQuery.data;
    if (prefs) {
      setLanguage(prefs.language || "en");
      setLearningLevel(prefs.learningLevel || "Beginner");
      setInterests(prefs.interests || []);
    }
  }, [preferencesQuery.data]);

  useEffect(() => {
    if (selectedCourse) {
      const fresh = courses.find((course) => course.id === selectedCourse.id);
      if (fresh) setSelectedCourse(fresh);
    }
  }, [courses, selectedCourse?.id]);

  const openLesson = (course: Course, lesson: Lesson) => {
    setSelectedCourse(course);
    setSelectedLesson(lesson);
    progressMutation.mutate({ courseId: course.id, lessonId: lesson.id, status: "in_progress", language });
  };
  const completeLesson = () => {
    if (!selectedCourse || !selectedLesson) return;
    progressMutation.mutate({ courseId: selectedCourse.id, lessonId: selectedLesson.id, status: "completed", language });
    setSelectedLesson(null);
  };
  const toggleSavedCourse = (course: Course) => savedMutation.mutate({ resourceId: course.id, saved: !savedIds.includes(course.id) });
  const createActionPlan = () => {
    if (!selectedCourse || !selectedLesson) return;
    const tasks = (selectedLesson.actionTasks ?? []).map((title) => ({ title }));
    if (!tasks.length) return;
    actionMutation.mutate({ courseId: selectedCourse.id, lessonId: selectedLesson.id, title: selectedLesson.title, tasks }, { onSuccess: () => setSelectedLesson(null) });
  };

  const totalLessons = courses.reduce((sum, course) => sum + (course.lessonCount || 0), 0);
  const completionPercent = totalLessons ? Math.round((completedIds.length / totalLessons) * 100) : 0;
  const continueItem = inProgress[0];
  const continueCourse = courses.find((course) => course.id === continueItem?.courseId);
  const continueLesson = continueCourse?.lessons.find((lesson) => lesson.id === continueItem?.lessonId);
  const seasonal = recommendationQuery.data?.data?.seasonal;

  if (catalogQuery.isLoading) return <div className="w-full space-y-5"><div className="h-28 animate-pulse rounded-2xl bg-slate-100" /><div className="grid gap-4 sm:grid-cols-3">{[1,2,3].map((x) => <div key={x} className="h-28 animate-pulse rounded-2xl bg-slate-100" />)}</div><div className="h-72 animate-pulse rounded-2xl bg-slate-100" /></div>;

  if (catalogQuery.isError) return <div className="space-y-4"><h1 className="text-2xl font-bold text-slate-900">Education Center</h1><Card><CardContent className="flex flex-col items-start gap-3 p-6"><p className="font-semibold">Learning courses could not be loaded.</p><p className="text-sm text-slate-500">Check that the FastAPI backend has restarted with the Education Center routes.</p><Button onClick={() => catalogQuery.refetch()}>Try again</Button></CardContent></Card></div>;

  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <section className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-100 p-3 text-emerald-800"><GraduationCap className="h-6 w-6" /></div><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Farmer learning & development</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Education Center</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">Learn practical farming skills through structured courses, local-language lessons and activities you can apply on your farm.</p></div></div>
          <label className="flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"><Languages className="h-4 w-4 text-emerald-700" /><select value={language} onChange={(event) => { const next=event.target.value; setLanguage(next); preferencesMutation.mutate({ language:next, learningLevel, interests }); }} className="bg-transparent outline-none">{LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-xl shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Available courses</p><p className="mt-1 text-2xl font-bold text-slate-900">{courses.length}</p></CardContent></Card>
        <Card className="rounded-xl shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Lessons completed</p><p className="mt-1 text-2xl font-bold text-slate-900">{completedIds.length}<span className="text-sm font-normal text-slate-500"> / {totalLessons}</span></p></CardContent></Card>
        <Card className="rounded-xl shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Learning progress</p><p className="mt-1 text-2xl font-bold text-emerald-700">{completionPercent}%</p><div className="mt-2 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-600" style={{ width: completionPercent + "%" }} /></div></CardContent></Card>
        <Card className="rounded-xl shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Saved courses</p><p className="mt-1 text-2xl font-bold text-slate-900">{savedIds.length}</p></CardContent></Card>
      </section>

      {continueCourse && continueLesson && <Card className="overflow-hidden rounded-2xl border-emerald-200 shadow-sm"><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><PlayCircle className="h-6 w-6" /></div><div><Badge variant="outline" className="border-emerald-200 text-emerald-700">Continue learning</Badge><h2 className="mt-1 font-semibold text-slate-900">{continueCourse.title}</h2><p className="text-sm text-slate-500">{continueLesson.title}</p></div></div><Button onClick={() => openLesson(continueCourse, continueLesson)}>Resume lesson <ChevronRight className="ml-1 h-4 w-4" /></Button></CardContent></Card>}

      {seasonal && <Card className="rounded-2xl border-sky-100 bg-sky-50/40 shadow-sm"><CardContent className="flex items-start gap-3 p-4"><Sprout className="mt-1 h-5 w-5 text-sky-700" /><div><p className="font-semibold text-slate-900">Seasonal learning suggestion</p><p className="mt-1 text-sm font-medium text-sky-900">{seasonal.title}</p><p className="mt-1 text-sm text-slate-600">{seasonal.description}</p><p className="mt-2 text-xs text-slate-500">{seasonal.basis}</p></div></CardContent></Card>}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold text-slate-900">{showSaved ? "My saved courses" : "Explore courses"}</h2><p className="text-sm text-slate-500">Structured learning with short lessons and practical activities.</p></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search courses..." className="pl-9 sm:w-64" /></div><Button variant={showSaved ? "default" : "outline"} onClick={() => setShowSaved((value) => !value)}><Bookmark className="mr-2 h-4 w-4" />{showSaved ? "All courses" : "Saved"}</Button></div></div>
        <div className="flex gap-2 overflow-x-auto pb-1">{categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={cn("shrink-0 rounded-full border px-3 py-2 text-sm", category === item ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{item}</button>)}</div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredCourses.map((course) => {
            const courseCompleted = course.lessons.filter((lesson) => completedIds.includes(lesson.id)).length;
            const pct = course.lessonCount ? Math.round(courseCompleted / course.lessonCount * 100) : 0;
            const saved = savedIds.includes(course.id);
            return <Card key={course.id} className="flex h-full flex-col rounded-2xl border-slate-200 shadow-sm transition hover:border-emerald-200 hover:shadow-md"><CardHeader className="space-y-3 pb-3"><div className="flex items-center justify-between"><Badge variant="outline">{course.category}</Badge><Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{course.level}</Badge></div><div><CardTitle className="text-lg leading-6">{course.title}</CardTitle><CardDescription className="mt-2 line-clamp-3">{course.description}</CardDescription></div></CardHeader><CardContent className="mt-auto space-y-3"><div className="flex items-center justify-between text-xs text-slate-500"><span className="inline-flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" />{course.lessonCount} lessons</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{course.estimatedMinutes} min</span></div><div><div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Course progress</span><span className="font-medium text-slate-700">{pct}%</span></div><div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-600" style={{ width: pct + "%" }} /></div></div><div className="flex gap-2"><Button className="flex-1" onClick={() => setSelectedCourse(course)}>View course <ChevronRight className="ml-1 h-4 w-4" /></Button><Button variant="outline" size="icon" aria-label={saved ? "Unsave course" : "Save course"} onClick={() => toggleSavedCourse(course)}><Bookmark className={cn("h-4 w-4", saved && "fill-current text-emerald-700")} /></Button></div></CardContent></Card>;
          })}
          {filteredCourses.length === 0 && <Card className="border-dashed md:col-span-2 xl:col-span-3"><CardContent className="py-12 text-center"><BookOpen className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 font-semibold text-slate-800">No courses match this view</p><p className="mt-1 text-sm text-slate-500">Change your search or category filter.</p></CardContent></Card>}
        </div>
      </section>

      {certificates.length > 0 && <section className="space-y-3"><div><h2 className="text-lg font-semibold text-slate-900">My course certificates</h2><p className="text-sm text-slate-500">Certificates are issued when every published lesson in a course is completed.</p></div><div className="grid gap-3 md:grid-cols-2">{certificates.map((certificate:any)=><Card key={certificate.id} className="border-emerald-200"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><GraduationCap className="h-6 w-6" /></div><div className="min-w-0"><p className="font-semibold text-slate-900">{certificate.courseTitle}</p><p className="text-xs text-slate-500">{certificate.certificateNumber}</p><p className="mt-1 text-xs text-emerald-700">{certificate.completedLessons} lessons completed · {new Date(certificate.issuedAt).toLocaleDateString()}</p></div></CardContent></Card>)}</div></section>}

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-5 w-5 text-emerald-700" /> Ask the learning assistant</CardTitle><CardDescription>Ask questions in your selected language. Responses use the AgriConnect AI assistant with recent conversation context and verified lesson references where available.</CardDescription></CardHeader><CardContent className="space-y-3"><form onSubmit={(event) => { event.preventDefault(); if (assistantQuestion.trim()) assistantMutation.mutate({ question: assistantQuestion, language }); }} className="flex gap-2"><Input value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} placeholder="Ask about soil, irrigation, pests or farm selling..." /><Button type="submit" disabled={assistantMutation.isPending || assistantQuestion.trim().length < 3}>{assistantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}</Button></form>{assistantReply && {(conversationQuery.data?.data?.messages || []).slice(-6).map((message:any,index:number)=><div key={index} className={cn("mb-2 rounded-lg p-3 text-sm",message.role==="user"?"ml-8 bg-emerald-50 text-emerald-900":"mr-8 bg-slate-50 text-slate-700")}><p className="mb-1 text-[10px] font-semibold uppercase text-slate-400">{message.role==="user"?"You":"Assistant"}</p>{message.content}</div>)}<div className="rounded-xl bg-slate-50 p-4"><p className="whitespace-pre-line text-sm leading-6 text-slate-700">{assistantReply.reply}</p>{assistantReply.sources?.length > 0 && <div className="mt-3 border-t pt-3"><p className="text-xs font-semibold text-slate-500">LESSONS USED</p>{assistantReply.sources.map((source: any) => <p key={source.lessonId} className="mt-1 text-xs text-emerald-800">{source.title}</p>)}</div>}{assistantReply.disclaimer && <p className="mt-3 text-xs text-slate-500">{assistantReply.disclaimer}</p>}</div>}{assistantMutation.isError && <p className="text-sm text-red-600">The learning assistant is unavailable. Please try again.</p>}</CardContent></Card>
        <Card className="rounded-2xl shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-5 w-5 text-emerald-700" /> My farm action plans</CardTitle><CardDescription>Turn lesson activities into trackable tasks.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="mb-4 rounded-xl border p-3"><p className="text-sm font-semibold text-slate-800">Learning preferences</p><div className="mt-2 flex flex-wrap items-center gap-2"><select value={learningLevel} onChange={e=>{setLearningLevel(e.target.value);preferencesMutation.mutate({language,learningLevel:e.target.value,interests})}} className="h-9 rounded-lg border px-2 text-sm"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select>{["Crop Management","Irrigation","Pest Management","Farm Business","Post-harvest"].map(item=><label key={item} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={interests.includes(item)} onChange={e=>{const next=e.target.checked?[...interests,item]:interests.filter(x=>x!==item);setInterests(next);preferencesMutation.mutate({language,learningLevel,interests:next})}} />{item}</label>)}</div><p className="mt-2 text-xs text-slate-500">Preferences are saved to your farmer account.</p></div>{plans.length ? plans.slice(0,4).map((plan: any) => <div key={plan.id} className="rounded-xl border p-3"><p className="font-medium text-slate-800">{plan.title}</p><p className="mt-1 text-xs text-slate-500">{plan.tasks?.filter((task: any) => task.completed).length || 0} of {plan.tasks?.length || 0} tasks completed</p><div className="mt-3 space-y-2">{(plan.tasks||[]).map((task:any)=><label key={task.id} className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(task.completed)} disabled={taskMutation.isPending} onChange={event=>taskMutation.mutate({planId:plan.id,taskId:task.id,completed:event.target.checked})} className="mt-1 accent-emerald-700" /><span className={task.completed?"text-slate-400 line-through":""}>{task.title}</span></label>)}</div></div>) : <div className="rounded-xl border border-dashed p-6 text-center"><ClipboardCheck className="mx-auto h-7 w-7 text-slate-400" /><p className="mt-2 text-sm text-slate-600">No action plans yet. Open a lesson and create a practical checklist.</p></div>}</CardContent></Card>
      </section>

      {selectedCourse && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-label="Course details"><Card className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl"><CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><Badge variant="outline">{selectedCourse.category}</Badge><CardTitle className="mt-2 text-xl">{selectedCourse.title}</CardTitle><CardDescription className="mt-1">{selectedCourse.description}</CardDescription></div><Button variant="ghost" size="icon" onClick={() => setSelectedCourse(null)}><X className="h-5 w-5" /></Button></div></CardHeader><CardContent className="space-y-3 p-4 sm:p-6"><p className="text-sm font-semibold text-slate-700">Course curriculum · {selectedCourse.lessonCount} lessons</p>{selectedCourse.lessons.map((lesson) => { const done = completedIds.includes(lesson.id); return <div key={lesson.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">{done ? <CheckCircle2 className="h-5 w-5" /> : <PlayCircle className="h-5 w-5" />}</div><div><p className="font-medium text-slate-900">{lesson.order}. {lesson.title}</p><p className="mt-1 text-sm text-slate-500">{lesson.summary}</p><p className="mt-1 text-xs text-slate-400">{lesson.estimatedMinutes || 10} minutes</p></div></div><Button variant={done ? "outline" : "default"} onClick={() => openLesson(selectedCourse, lesson)}>{done ? "Review lesson" : "Start lesson"}</Button></div>; })}</CardContent></Card></div>}

      {selectedLesson && selectedCourse && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3" role="dialog" aria-modal="true" aria-label="Lesson viewer"><Card className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl"><CardHeader className="border-b"><div className="flex items-start justify-between"><div><Badge variant="outline">{selectedCourse.category}</Badge><CardTitle className="mt-2 text-xl">{selectedLesson.title}</CardTitle><CardDescription>{selectedLesson.summary}</CardDescription></div><Button variant="ghost" size="icon" onClick={() => setSelectedLesson(null)}><X className="h-5 w-5" /></Button></div></CardHeader><CardContent className="space-y-5 p-4 sm:p-6">{selectedLesson.videoUrl && <video controls className="w-full rounded-xl" src={selectedLesson.videoUrl}>Your browser does not support video playback.</video>}<article className="whitespace-pre-line text-sm leading-7 text-slate-700">{selectedLesson.content}</article>{selectedLesson.sourceUrl && <a href={selectedLesson.sourceUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-emerald-700 underline">Source: {selectedLesson.sourceName || "Reference"}</a>}<div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4"><div className="flex items-center gap-2 font-semibold text-slate-900"><ClipboardCheck className="h-4 w-4 text-emerald-700" /> Practical farm checklist</div>{selectedLesson.actionTasks?.length ? <ul className="mt-3 space-y-2">{selectedLesson.actionTasks.map((task, index) => <li key={index} className="flex gap-2 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />{task}</li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No checklist has been added to this lesson yet.</p>}<Button variant="outline" className="mt-3" disabled={!selectedLesson.actionTasks?.length || actionMutation.isPending} onClick={createActionPlan}>Add checklist to my action plans</Button></div><div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button variant="outline" onClick={() => setSelectedLesson(null)}>Close lesson</Button><Button onClick={completeLesson} disabled={progressMutation.isPending}><CheckCircle2 className="mr-2 h-4 w-4" />Mark as completed</Button></div></CardContent></Card></div>}
    </div>
  );
}
