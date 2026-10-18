import type { ReactNode } from "react";
import { Camera, Calendar, ChevronDown, ChevronRight, Image as ImageIcon, Link2, Mail, Search } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Help "cues": a tiny picture of the exact thing a step asks you to tap, built from the spec's own
 * components (nav tab, plus square, primary/secondary button, mono link, person switcher…) so the
 * picture always matches the real screen. No emoji, no new colors.
 */
export type Cue =
  | { kind: "nav"; tab: "Today" | "Closet" | "Shop" | "Fits" }
  | { kind: "plus" }
  | { kind: "button"; label: string; variant?: "primary" | "secondary" }
  | { kind: "link"; label: string }
  | { kind: "switcher"; label: string }
  | { kind: "tabs"; active: string; others: string[] }
  | { kind: "swipe" }
  | { kind: "strip"; label: string }
  | { kind: "row"; label: string; value?: string }
  | { kind: "icon"; name: "camera" | "calendar" | "search" | "image" | "link" | "mail" }
  | { kind: "verdict"; word: "FITS" | "RISKY" | "PASS" }
  | { kind: "calendar" }
  | { kind: "board" }
  | { kind: "wait" };

const NAV_TABS = ["Today", "Closet", "+", "Shop", "Fits"] as const;

/** A small nav replica with one tab active (black + underline), the rest graphite. */
function NavCue({ tab }: { tab: string }) {
  return (
    <div className="flex w-full items-center justify-between gap-1 border-t border-ink px-1 pt-2">
      {NAV_TABS.map((t) => t === "+" ? (
        <span key={t} className="flex size-4 shrink-0 items-center justify-center bg-ink text-paper"><PlusGlyph size={8} /></span>
      ) : (
        <span key={t} className={cn("mono text-[6px] tracking-normal", t === tab ? "border-b-[1.5px] border-ink text-ink" : "text-graphite")}>{t}</span>
      ))}
    </div>
  );
}

function PlusGlyph({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M12 4v16M4 12h16" /></svg>;
}

function MiniButton({ label, variant = "primary" }: { label: string; variant?: "primary" | "secondary" }) {
  return (
    <span className={cn("mono inline-flex h-8 max-w-full items-center justify-center truncate px-3 text-[8px] tracking-[0.14em]", variant === "primary" ? "bg-ink text-paper" : "border border-ink bg-paper text-ink")}>{label}</span>
  );
}

const ICONS = { camera: Camera, calendar: Calendar, search: Search, image: ImageIcon, link: Link2, mail: Mail } as const;

export function CueArt({ cue }: { cue: Cue }) {
  switch (cue.kind) {
    case "nav": return <NavCue tab={cue.tab} />;
    case "plus": return <span className="flex size-9 items-center justify-center bg-ink text-paper"><PlusGlyph size={16} /></span>;
    case "button": return <MiniButton label={cue.label} variant={cue.variant} />;
    case "link": return <span className="mono text-[8px] text-ink">{cue.label}</span>;
    case "switcher": return <span className="mono inline-flex items-center gap-1 text-[9px] text-ink">{cue.label} <ChevronDown className="size-2" strokeWidth={2.5} /></span>;
    case "tabs": return (
      <span className="flex gap-2.5 whitespace-nowrap">
        <span className="mono border-b-[1.5px] border-ink text-[8px] text-ink">{cue.active}</span>
        {cue.others.map((o) => <span key={o} className="mono text-[8px] text-graphite">{o}</span>)}
      </span>
    );
    case "swipe": return (
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-ink"><svg width="34" height="10" viewBox="0 0 34 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M1 5h32M28 1l4 4-4 4M6 1L2 5l4 4" /></svg></span>
        <span className="mono text-[8px] text-ink">01 / 03</span>
      </span>
    );
    case "strip": return <span className="mono w-full border-y border-ink py-1.5 text-center text-[7px] text-ink">{cue.label}</span>;
    case "row": return (
      <span className="flex w-full items-center justify-between border-b border-ink pb-1">
        <span className="mono text-[7px] text-graphite">{cue.label}</span>
        <span className="flex items-center gap-1 text-[9px] text-ink">{cue.value}<ChevronRight className="size-2.5 text-graphite" strokeWidth={1.5} /></span>
      </span>
    );
    case "icon": { const I = ICONS[cue.name]; return <span className="flex size-9 items-center justify-center border border-ink text-ink"><I className="size-4" strokeWidth={1.5} /></span>; }
    case "verdict": return <span className="serif text-[22px] leading-none text-ink">{cue.word}</span>;
    case "calendar": return (
      <span className="grid w-[84px] grid-cols-7 gap-px border-t border-ink pt-1">
        {Array.from({ length: 21 }, (_, i) => <span key={i} className={cn("aspect-square", i === 16 ? "bg-ink" : i === 3 || i === 9 || i === 11 ? "bg-graphite/50" : "bg-paper")} />)}
      </span>
    );
    case "board": return (
      <span className="grid h-11 w-12 grid-cols-2 gap-px">
        <span className="row-span-2 bg-ink/80" /><span className="bg-ink/50" /><span className="grid grid-cols-2 gap-px"><span className="bg-ink/30" /><span className="bg-ink/30" /></span>
      </span>
    );
    case "wait": return (
      <span className="flex w-full flex-col gap-1.5">
        <span className="h-[3px] w-full bg-ink/12"><span className="block h-full w-2/3 bg-ink" /></span>
        <span className="mono text-[7px] text-ink">042 / 150</span>
      </span>
    );
  }
}

/** Bone tile that holds a cue, the way photos sit on Bone everywhere else. */
export function CueTile({ cue, className, children }: { cue?: Cue; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-center overflow-hidden bg-bone px-2", className)}>
      <div className="flex w-full max-w-[220px] items-center justify-center">{cue ? <CueArt cue={cue} /> : children}</div>
    </div>
  );
}
