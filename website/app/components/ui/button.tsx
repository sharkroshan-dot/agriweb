import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary" | "success" | "warning" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const baseStyles =
  "inline-flex items-center justify-center gap-2 rounded-lg border font-medium shadow-sm transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2";

const variantStyles = {
  default: "border-emerald-600 bg-emerald-600 text-white hover:border-emerald-700 hover:bg-emerald-700",
  outline: "border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700",
  ghost: "border-transparent bg-transparent text-slate-700 shadow-none hover:bg-slate-100",
  destructive: "border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700",
  secondary: "border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-300 hover:bg-slate-200",
  success: "border-emerald-600 bg-emerald-600 text-white hover:border-emerald-700 hover:bg-emerald-700",
  warning: "border-amber-500 bg-amber-500 text-slate-950 hover:border-amber-600 hover:bg-amber-600",
  link: "h-auto rounded-md border-transparent bg-transparent p-0 text-emerald-700 shadow-none hover:bg-transparent hover:text-emerald-800 hover:underline",
};

const sizeStyles = {
  default: "min-h-10 px-4 py-2 text-sm",
  sm: "min-h-9 px-3 py-2 text-xs",
  lg: "min-h-11 px-5 py-2.5 text-base",
  icon: "h-10 w-10 p-0",
};

export function Button({ className, variant = "default", size = "default", asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)} {...props} />;
}
