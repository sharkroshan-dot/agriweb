import * as React from "react";
import { cn } from "../../lib/utils";
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>{variant?:"default"|"secondary"|"destructive"|"outline"|"success"|"warning"}
const variantStyles={
 default:"bg-emerald-600 text-white",
 secondary:"bg-slate-100 text-slate-700",
 destructive:"bg-red-600 text-white",
 outline:"border border-slate-200 bg-white text-slate-700",
 success:"bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
 warning:"bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15"
};
export function Badge({className,variant="default",...props}:BadgeProps){
 return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide",variantStyles[variant],className)} {...props}/>;
}
