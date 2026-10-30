"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Input } from "./input";

/** An underline password field with a Show / Hide pill, so nobody types a new password blind. */
export function PasswordInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className={`pr-20 ${className ?? ""}`} />
      <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} className="pill pill-sm absolute right-0 top-0 h-11 border-0 px-2" data-testid="password-show">{shown ? "Hide" : "Show"}</button>
    </div>
  );
}
