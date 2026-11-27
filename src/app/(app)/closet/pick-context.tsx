"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/** The mirror's pick mode, shared by the tools row (the Mirror pill) and the grid (the taps). */
type Pick = { picking: boolean; setPicking: (v: boolean) => void };
const Ctx = createContext<Pick>({ picking: false, setPicking: () => {} });

export function ClosetPickProvider({ children }: { children: ReactNode }) {
  const [picking, setPicking] = useState(false);
  return <Ctx.Provider value={{ picking, setPicking }}>{children}</Ctx.Provider>;
}

export const useClosetPick = () => useContext(Ctx);
