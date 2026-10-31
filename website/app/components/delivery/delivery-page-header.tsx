import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Navigation, Play } from "lucide-react";
import { Button } from "../ui/button";

type Props = { title: string; description: string; actionHref?: string; actionLabel?: string; children?: ReactNode };

export function DeliveryPageHeader({ title, description, actionHref, actionLabel, children }: Props) {
  return (
    <header className="delivery-page-header">
      <div className="min-w-0">
        <p className="delivery-page-eyebrow"><Navigation className="h-3.5 w-3.5" /> Delivery operations</p>
        <h1 className="delivery-page-title">{title}</h1>
        <p className="delivery-page-description">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {actionHref && actionLabel && <Button asChild className="min-h-11 bg-emerald-600 hover:bg-emerald-700"><Link href={actionHref}><ArrowRight className="mr-2 h-4 w-4" />{actionLabel}</Link></Button>}
      </div>
    </header>
  );
}
