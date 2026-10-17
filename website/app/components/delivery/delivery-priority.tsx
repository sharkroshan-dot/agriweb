"use client";

import { Badge } from "../../components/ui/badge";

const PRIORITY_META: Record<string, { label: string; variant: "destructive" | "warning" | "success" }> = {
  "3": { label: "Urgent", variant: "destructive" },
  "2": { label: "High", variant: "warning" },
  "1": { label: "Normal", variant: "success" },
};

export function DeliveryPriorityBadge({ delivery, compact = false }: { delivery: any; compact?: boolean }) {
  const raw = delivery?.priority;
  const key = String(raw ?? "");
  const meta = PRIORITY_META[key] || {
    label: delivery?.priorityLabel || "Normal",
    variant: "success" as const,
  };
  const deadline = delivery?.deliveryDeadline;
  const deadlineText = deadline
    ? new Date(deadline).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const liveHours = deadline
    ? Math.max(0, (new Date(deadline).getTime() - Date.now()) / 3600000)
    : Number(delivery?.deliveryHoursRemaining);
  const hoursText = Number.isFinite(liveHours)
    ? liveHours < 1
      ? `${Math.max(1, Math.round(liveHours * 60))}m left`
      : `${Math.floor(liveHours)}h ${Math.round((liveHours % 1) * 60)}m left`
    : null;

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "rounded-lg border bg-muted/20 p-2.5"}>
      <Badge variant={meta.variant}>{meta.label}</Badge>
      {deadlineText && <span className="text-xs font-medium text-slate-700">Deliver by {deadlineText}</span>}
      {hoursText && <span className="text-xs text-muted-foreground">{hoursText}</span>}
      {!compact && delivery?.priorityReason && (
        <span className="block w-full text-[11px] text-muted-foreground">{delivery.priorityReason}</span>
      )}
    </div>
  );
}

export function deliveryPriorityRank(delivery: any): number {
  const value = Number(delivery?.priority);
  return Number.isFinite(value) ? value : 1;
}

export function sortByDeliveryPriority<T extends any>(items: T[]): T[] {
  return [...items].sort((a: any, b: any) => {
    const priorityDiff = deliveryPriorityRank(b) - deliveryPriorityRank(a);
    if (priorityDiff) return priorityDiff;
    const aDeadline = new Date(a?.deliveryDeadline || 0).getTime();
    const bDeadline = new Date(b?.deliveryDeadline || 0).getTime();
    if (aDeadline && bDeadline && aDeadline !== bDeadline) return aDeadline - bDeadline;
    return 0;
  });
}
