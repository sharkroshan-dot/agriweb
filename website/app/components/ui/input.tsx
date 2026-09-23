import * as React from "react";
import { cn } from "../../lib/utils";
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export const Input=React.forwardRef<HTMLInputElement,InputProps>(({className,...props},ref)=>(
 <input ref={ref} className={cn("flex h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10",className)} {...props}/>
));
Input.displayName="Input";
