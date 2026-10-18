import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";

/** 56px header: left slot (person menu), centered wordmark, right action. */
export function AppHeader({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-paper">
      <div className="mx-auto grid h-14 max-w-[480px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3">
        <div className="justify-self-start">{left}</div>
        <Wordmark className="justify-self-center" />
        <div className="justify-self-end">{right}</div>
      </div>
    </header>
  );
}
