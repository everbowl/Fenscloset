import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { getStyleProfile } from "@/lib/profiles/service";
import { resolveProfileTarget } from "../target";
import { StyleEditor } from "./style-editor";
import { TasteMemory } from "./taste-memory";
import { tasteLines } from "@/lib/outfits/taste";
import { listInspiration } from "@/lib/profiles/inspiration";
import { InspirationBoard } from "./inspiration-board";

export const metadata = { title: "Style profile" };
export const dynamic = "force-dynamic";

export default async function StyleProfilePage() {
  const { viewer, owner, mine, canEdit } = await resolveProfileTarget();
  const [style, colors, words, taste, looks] = await Promise.all([
    getStyleProfile(owner.id),
    db.color.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.styleWord.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    tasteLines(owner.id),
    listInspiration(owner.id),
  ]);
  return (
    <div>
      <PageHeader title={mine ? "Style" : owner.first} accent={mine ? "profile" : "style"} />
      <StyleEditor ownerId={owner.id} style={style} colors={colors} words={words} canEdit={canEdit} canEditLists={viewer.role === "admin"} />
      <div className="mt-6"><InspirationBoard ownerId={owner.id} looks={looks} canEdit={canEdit} isMinor={owner.role === "minor"} /></div>
      <div className="mt-6"><TasteMemory ownerId={owner.id} lines={taste} canEdit={canEdit} /></div>
    </div>
  );
}
