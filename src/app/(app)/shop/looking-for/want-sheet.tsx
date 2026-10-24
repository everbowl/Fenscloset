"use client";

import { useId, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

/** One line about something to find, as the person would say it. Used to add a want and to change one. */
export function WantSheet({ open, onClose, title, value, onSave }: { open: boolean; onClose: () => void; title: string; value: string; onSave: (text: string) => void }) {
  const [v, setV] = useState(value);
  const id = useId();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim().length >= 3) { onSave(v); onClose(); } }} className="space-y-5">
        <Field label="What are you after?" htmlFor={id}>
          <Input id={id} value={v} onChange={(e) => setV(e.target.value)} autoFocus maxLength={160} placeholder="navy cashmere crewneck under $200" data-testid="want-text" />
        </Field>
        <p className="mono text-graphite">Say it the way you would to a friend: color, material, fit, a price cap. Sizes stay out of the search; the Shop judges fit when you tap Judge it.</p>
        <Button type="submit" className="w-full" disabled={v.trim().length < 3} data-testid="want-save">Search the stores</Button>
      </form>
    </Sheet>
  );
}
