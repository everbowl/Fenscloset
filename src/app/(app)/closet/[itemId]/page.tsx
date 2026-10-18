import { notFound } from "next/navigation";
import { requirePerson } from "@/lib/auth/current";
import { getItemDetail, loadItemLists, statusWord } from "@/lib/items/query";
import { canEditItem, canSeeWornPhoto } from "@/lib/people/visibility";
import { ItemEditor } from "./item-editor";
import { wearHistory } from "@/lib/fits/service";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const item = await getItemDetail(itemId);
  return { title: item?.name ?? "Item" };
}

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const person = await requirePerson();
  const { itemId } = await params;
  const item = await getItemDetail(itemId);
  if (!item) notFound();
  const [lists, seeWorn, history] = await Promise.all([loadItemLists(person.id), canSeeWornPhoto(person, item.owner), wearHistory(item.id)]);
  const photos = item.photos.filter((p) => p.kind !== "thumb" && (p.kind !== "worn" || seeWorn));
  return (
    <ItemEditor
      key={item.updatedAt.toISOString()}
      item={{
        id: item.id, name: item.name ?? "Untitled piece", ownerId: item.ownerId, ownerName: item.owner.name.split(" ")[0], mine: item.ownerId === person.id,
        status: statusWord(item), laundryStatus: item.laundryStatus, isFavorite: item.isFavorite, neverSuggest: item.neverSuggest, wearCount: item.wearCount,
        categoryId: item.categoryId, subcategoryId: item.subcategoryId, colorIds: item.colors.map((c) => c.id), patternId: item.patterns[0]?.id ?? null,
        fabricId: item.fabrics[0]?.id ?? null, seasonIds: item.seasons.map((s) => s.id), formalityId: item.formalities[0]?.id ?? null,
        occasionIds: item.occasions.map((o) => o.id), tagIds: item.tags.map((t) => t.id), brandId: item.brandId, storeId: item.storeId, size: item.size,
        purchasePrice: item.purchasePrice ? String(item.purchasePrice) : null, purchaseDate: item.purchaseDate ? item.purchaseDate.toISOString().slice(0, 10) : null,
        purchaseUrl: item.purchaseUrl, fitNotes: item.fitNotes,
        closetIds: item.closets.map((c) => c.closetId).filter((id) => lists.closets.some((c) => c.id === id)),
        sharedWithIds: item.shares.map((s) => s.personId),
        photos: photos.map((p) => ({ id: p.id, kind: p.kind, key: p.bucketKey, isPrimary: p.isPrimary })),
        lastWornAt: item.lastWornAt?.toISOString() ?? null,
        wearHistory: history.map((h) => ({ wornOn: h.wornOn, title: h.title })),
        retired: item.retiredAt ? { reason: item.retiredReason ?? "donate", at: item.retiredAt.toISOString() } : null,
      }}
      lists={lists}
      canEdit={canEditItem(person, item.ownerId)}
      canEditLists={person.role === "admin"}
    />
  );
}
