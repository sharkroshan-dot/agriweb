import * as React from "react";
import { cn } from "../../lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

function getProgressWidthClass(value: number) {
  if (value >= 80) return "w-full";
  if (value >= 60) return "w-[80%]";
  if (value >= 40) return "w-[60%]";
  if (value >= 20) return "w-[40%]";
  return "w-[20%]";
}

export function Progress({ className, value = 0, ...props }: ProgressProps) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-200", className)} {...props}>
      <div className={cn("h-full rounded-full bg-emerald-600 transition-all", getProgressWidthClass(Math.max(0, Math.min(100, value))))} />
    </div>
  );
}
