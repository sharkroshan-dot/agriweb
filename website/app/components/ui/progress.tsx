import * as React from "react";
import { cn } from "../../lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

export function Progress({ className, value = 0, ...props }: ProgressProps) {
  const percentage = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-200", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percentage)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-emerald-600 transition-[width] duration-300 ease-out"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
