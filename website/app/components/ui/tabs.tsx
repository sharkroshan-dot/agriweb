"use client";

import * as React from "react";
import { cn } from "../../lib/utils";

interface TabsContextValue<T extends string> {
  value: T;
  onValueChange?: (value: T) => void;
}

const TabsContext = React.createContext<TabsContextValue<any> | null>(null);

interface TabsProps<T extends string> extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: T;
  value?: T;
  onValueChange?: (value: T) => void;
}

export function Tabs<T extends string>({ className, children, defaultValue, value, onValueChange, ...props }: TabsProps<T>) {
  const [activeValue, setActiveValue] = React.useState<T>(defaultValue || value as T);

  const contextValue: TabsContextValue<T> = {
    value: value ?? activeValue,
    onValueChange: (val: T) => {
      setActiveValue(val);
      onValueChange?.(val);
    },
  };

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={cn("flex flex-col gap-4", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("selection-control inline-flex rounded-full border border-slate-200", className)} {...props}>{children}</div>;
}

export function TabsTrigger<T extends string>({ className, value, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: T }) {
  const context = React.useContext(TabsContext) as TabsContextValue<T> | null;
  const isActive = context?.value === value;

  return (
    <button
      type="button"
      value={value}
      onClick={() => context?.onValueChange?.(value)}
      className={cn(
        "selection-item rounded-full px-3 py-2 text-sm font-medium",
        isActive ? "selection-item-active" : "selection-item-inactive",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent<T extends string>({ className, value, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: T }) {
  const context = React.useContext(TabsContext) as TabsContextValue<T> | null;
  const isActive = context?.value === value;

  if (!isActive) return null;

  return <div className={cn("mt-4", className)} {...props}>{children}</div>;
}