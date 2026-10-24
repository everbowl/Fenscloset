"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import type { ListEntry } from "@/lib/lists/service";

export function ParentPicker({ label, kind, parents, selected }: { label: string; kind: string; parents: ListEntry[]; selected?: string }) {
  const router = useRouter();
  return (
    <div className="mb-5">
      <Field label={label} htmlFor="parent">
        <Select id="parent" value={selected ?? ""} onChange={(e) => router.push(`/admin/lists/${kind}?parent=${e.target.value}`)}>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
    </div>
  );
}
