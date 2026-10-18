import { cn } from "@/lib/cn";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* Underline inputs per the brand: no box, 1px black rule beneath, 17px text. */
const base =
  "w-full h-9 border-0 border-b border-ink bg-transparent px-0 text-[17px] text-ink placeholder:text-graphite/70 " +
  "focus:outline-none focus:border-b-2 disabled:text-graphite";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(base, "appearance-none pr-8", className)} {...props} />
      <svg className="pointer-events-none absolute right-0 top-1/2 size-3 -translate-y-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "h-auto min-h-20 py-2 leading-snug", className)} {...props} />;
}
