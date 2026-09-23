import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary" | "success" | "warning" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const baseStyles = "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2";
const variantStyles = {
  default: "bg-emerald-600 text-white hover:bg-emerald-700",
  outline: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
  destructive: "bg-red-600 text-white hover:bg-red-700",
  secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  success: "bg-green-600 text-white hover:bg-green-700",
  warning: "bg-yellow-500 text-black hover:bg-yellow-600",
  link: "h-auto rounded-none bg-transparent p-0 text-primary underline-offset-4 hover:underline",
};
const sizeStyles = {
  default: "px-4 py-2",
  sm: "px-3 py-1.5 text-xs",
  lg: "px-6 py-3 text-base",
  icon: "h-10 w-10 p-0",
};

export function Button({ className, variant = "default", size = "default", asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)} {...props} />;
}
