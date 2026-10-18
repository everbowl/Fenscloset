"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import type { ListEntry } from "@/lib/lists/service";

export function ParentPicker({ label, kind, parents, selected }: { label: string; kind: string; parents: ListEntry[]; selected?: string }) {
  const router = useRouter();
  return (
    <div className="mb-4 space-y-1.5">
      <label htmlFor="parent" className="block text-sm font-medium">{label}</label>
      <Select id="parent" value={selected ?? ""} onChange={(e) => router.push(`/admin/lists/${kind}?parent=${e.target.value}`)}>
        {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
    </div>
  );
}
