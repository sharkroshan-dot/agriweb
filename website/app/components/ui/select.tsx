"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onValueChange"> {
  onValueChange?: (value: string) => void;
}

export function Select({ className, value, onValueChange, children, ...props }: SelectProps) {
  const options = React.Children.toArray(children).filter((child): child is React.ReactElement => React.isValidElement(child));
  const items = options.flatMap((child) => {
    if (child.type === SelectContent) {
      return React.Children.toArray(child.props.children).filter((grandChild): grandChild is React.ReactElement => React.isValidElement(grandChild));
    }
    return [];
  });

  return (
    <div className="relative">
      <select
        className={cn("h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-700 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10", className)}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
        aria-label={props["aria-label"] ?? props.title ?? "Select an option"}
        title={props.title ?? props["aria-label"] ?? "Select an option"}
        {...props}
      >
        {items}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function SelectTrigger({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("relative", className)}>{children}</div>;
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span className="text-sm text-slate-500">{placeholder}</span>;
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function SelectItem({ children, value }: { children: React.ReactNode; value: string }) {
  return <option value={value}>{children}</option>;
}
