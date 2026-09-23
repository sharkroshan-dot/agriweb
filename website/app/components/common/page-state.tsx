"use client";

import Link from "next/link";
import { AlertTriangle, Inbox, RefreshCw, Plus, ArrowRight } from "lucide-react";
import { Button } from "../ui/button";

type PageStateProps = { title: string; description?: string; icon?: "empty" | "error"; actionLabel?: string; actionHref?: string; onAction?: () => void; retry?: () => void };

export function PageState({ title, description, icon="empty", actionLabel, actionHref, onAction, retry }: PageStateProps) {
  const Icon = icon === "error" ? AlertTriangle : Inbox;
  return (
    <div className="empty-state">
      <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${icon === "error" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}><Icon className="h-6 w-6"/></div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-slate-500">{description}</p>}
      {(actionLabel || retry) && <div className="mt-5 flex flex-wrap justify-center gap-2">
        {retry && <Button variant="outline" onClick={retry} className="gap-2"><RefreshCw className="h-4 w-4"/>Try again</Button>}
        {actionLabel && actionHref && <Link href={actionHref}><Button className="gap-2"><ArrowRight className="h-4 w-4"/>{actionLabel}</Button></Link>}
        {actionLabel && !actionHref && onAction && <Button onClick={onAction} className="gap-2"><Plus className="h-4 w-4"/>{actionLabel}</Button>}
      </div>}
    </div>
  );
}

export function PageErrorState({ title="We couldn't load this information", description="Please try again. If the problem continues, check your connection or contact support.", retry }: { title?: string; description?: string; retry?: () => void }) {
  return <PageState title={title} description={description} icon="error" retry={retry}/>;
}
