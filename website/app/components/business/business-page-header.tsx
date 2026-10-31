import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Briefcase, Plus } from "lucide-react";
import { Button } from "../ui/button";

type Props = {
  title: string;
  description: string;
  eyebrow?: string;
  actionHref?: string;
  actionLabel?: string;
  actionIcon?: "plus" | "arrow";
  children?: ReactNode;
};

export function BusinessPageHeader({ title, description, eyebrow = "B2B procurement", actionHref, actionLabel, actionIcon = "arrow", children }: Props) {
  return (
    <header className="business-page-header">
      <div className="min-w-0">
        <p className="business-page-eyebrow"><Briefcase className="h-3.5 w-3.5" /> {eyebrow}</p>
        <h1 className="business-page-title">{title}</h1>
        <p className="business-page-description">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {actionHref && actionLabel && <Button asChild className="bg-emerald-600 shadow-sm hover:bg-emerald-700"><Link href={actionHref}>{actionIcon === "plus" ? <Plus className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}{actionLabel}</Link></Button>}
      </div>
    </header>
  );
}
