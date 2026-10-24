"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SLOT_ID = "fc-header-action";

/** The header's right-hand slot. Pages fill it with <HeaderAction>. */
export function HeaderActionSlot() {
  return <div id={SLOT_ID} className="flex items-center justify-end" />;
}

/** Renders its children into the app header's right slot (search icon, CHECK-IN link…). */
export function HeaderAction({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(document.getElementById(SLOT_ID)); }, []);
  return el ? createPortal(children, el) : null;
}
