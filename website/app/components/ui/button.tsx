import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: "default"|"outline"|"ghost"|"destructive"|"secondary"|"success"|"warning"|"link";
  size?: "default"|"sm"|"lg"|"icon";
}
const baseStyles="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
const variantStyles={
  default:"bg-emerald-700 text-white shadow-sm hover:bg-emerald-800",
  outline:"border border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800",
  ghost:"bg-transparent text-slate-700 hover:bg-slate-100",
  destructive:"bg-red-600 text-white shadow-sm hover:bg-red-700",
  secondary:"bg-slate-100 text-slate-700 hover:bg-slate-200",
  success:"bg-emerald-700 text-white hover:bg-emerald-800",
  warning:"bg-amber-500 text-slate-950 shadow-sm hover:bg-amber-600",
  link:"h-auto rounded-md bg-transparent p-0 text-emerald-700 underline-offset-4 hover:underline",
};
const sizeStyles={default:"px-4 py-2.5",sm:"px-3 py-2 text-xs",lg:"px-6 py-3",icon:"h-10 w-10 p-0"};
export function Button({className,variant="default",size="default",asChild=false,...props}:ButtonProps){
 const Comp=asChild?Slot:"button";
 return <Comp className={cn(baseStyles,variantStyles[variant],sizeStyles[size],className)} {...props}/>;
}
