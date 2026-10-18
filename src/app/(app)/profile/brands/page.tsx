import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { getFavorites } from "@/lib/profiles/service";
import { resolveProfileTarget } from "../target";
import { FavoritesEditor } from "./favorites-editor";

export const metadata = { title: "Favorite brands & stores" };
export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const { viewer, owner, mine, canEdit } = await resolveProfileTarget();
  const [favs, brands, stores] = await Promise.all([
    getFavorites(owner.id),
    db.brand.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.store.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <Link href="/profile" className="mono mb-3 inline-block text-graphite">← Profile</Link>
      <PageHeader title={mine ? "Brands" : owner.first} accent={mine ? "& stores" : "brands"} />
      <FavoritesEditor ownerId={owner.id} favs={favs} brands={brands} stores={stores} canEdit={canEdit} canEditLists={viewer.role === "admin"} />
    </div>
  );
}
