import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";

type Props = { title: string; description: string; eyebrow?: string; actionHref?: string; actionLabel?: string; children?: ReactNode };

export function AdminPageHeader({ title, description, eyebrow = "Enterprise operations", actionHref, actionLabel, children }: Props) {
  return (
    <header className="admin-page-header">
      <div className="min-w-0">
        <p className="admin-page-eyebrow"><ShieldCheck className="h-3.5 w-3.5" /> {eyebrow}</p>
        <h1 className="admin-page-title">{title}</h1>
        <p className="admin-page-description">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {actionHref && actionLabel && <Button asChild className="min-h-10 bg-emerald-600 hover:bg-emerald-700"><Link href={actionHref}><ArrowRight className="mr-2 h-4 w-4" />{actionLabel}</Link></Button>}
      </div>
    </header>
  );
}
