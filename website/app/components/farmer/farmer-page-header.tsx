import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ClipboardList, Plus } from "lucide-react";
import { Button } from "../ui/button";

type FarmerPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  actionIcon?: "plus" | "arrow";
  children?: ReactNode;
};

export function FarmerPageHeader({ eyebrow = "Farm operations", title, description, actionHref, actionLabel, actionIcon = "arrow", children }: FarmerPageHeaderProps) {
  return (
    <header className="farmer-page-header">
      <div className="min-w-0">
        <p className="farmer-page-eyebrow"><ClipboardList className="h-3.5 w-3.5" /> {eyebrow}</p>
        <h1 className="farmer-page-title">{title}</h1>
        <p className="farmer-page-description">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {actionHref && actionLabel && (
          <Button asChild className="bg-emerald-600 shadow-sm hover:bg-emerald-700">
            <Link href={actionHref}>{actionIcon === "plus" ? <Plus className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}{actionLabel}</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
