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
  // The inspiration board is the owner's (and a minor's parents'), as its own line promises: nobody else gets its pictures or the words read from them (review E A5). canEdit is exactly owner-or-parent.
  const [style, colors, words, taste, looks] = await Promise.all([
    getStyleProfile(owner.id),
    db.color.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, hex: true } }),
    db.styleWord.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    tasteLines(owner.id),
    canEdit ? listInspiration(owner.id) : Promise.resolve([]),
  ]);
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title={mine ? "Style" : owner.first} accent={mine ? "profile" : "style"} />
      {!canEdit ? <p className="caption -mt-2 mb-4">{`${owner.first}'s style, read-only. Only ${owner.first}${owner.role === "minor" ? " and parents" : ""} can change it.`}</p> : null}
      <StyleEditor ownerId={owner.id} style={style} colors={colors} words={words} canEdit={canEdit} canEditLists={viewer.role === "admin"} />
      {canEdit ? <div className="mt-8"><InspirationBoard ownerId={owner.id} looks={looks} canEdit={canEdit} isMinor={owner.role === "minor"} /></div> : null}
      <div className="mt-8"><TasteMemory ownerId={owner.id} lines={taste} canEdit={canEdit} /></div>
    </div>
  );
}
