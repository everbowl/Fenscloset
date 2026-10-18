import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { getStyleProfile } from "@/lib/profiles/service";
import { resolveProfileTarget } from "../target";
import { StyleEditor } from "./style-editor";
import { TasteMemory } from "./taste-memory";
import { tasteLines } from "@/lib/outfits/taste";

export const metadata = { title: "Style profile" };
export const dynamic = "force-dynamic";

export default async function StyleProfilePage() {
  const { viewer, owner, mine, canEdit } = await resolveProfileTarget();
  const [style, colors, words, taste] = await Promise.all([
    getStyleProfile(owner.id),
    db.color.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.styleWord.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    tasteLines(owner.id),
  ]);
  return (
    <div>
      <Link href="/profile" className="mono mb-3 inline-block text-graphite">← Profile</Link>
      <PageHeader title={mine ? "Style" : owner.first} accent={mine ? "profile" : "style"} />
      <StyleEditor ownerId={owner.id} style={style} colors={colors} words={words} canEdit={canEdit} canEditLists={viewer.role === "admin"} />
      <div className="mt-6"><TasteMemory ownerId={owner.id} lines={taste} canEdit={canEdit} /></div>
    </div>
  );
}
