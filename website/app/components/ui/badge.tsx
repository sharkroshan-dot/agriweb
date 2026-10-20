import * as React from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

const variantStyles = {
  default: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  secondary: "border border-slate-200 bg-slate-100 text-slate-700",
  destructive: "border border-red-200 bg-red-50 text-red-700",
  outline: "border border-slate-200 bg-white text-slate-700",
  success: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border border-amber-200 bg-amber-50 text-amber-700",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return <span className={cn("inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium leading-none", variantStyles[variant], className)} {...props} />;
}
