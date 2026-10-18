import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const base =
  "w-full h-11 rounded-xl border border-border bg-surface px-3.5 text-[16px] text-foreground placeholder:text-stone-400 " +
  "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-stone-100";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, "appearance-none pr-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "h-auto min-h-24 py-2.5", className)} {...props} />;
}
