import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { getFavorites } from "@/lib/profiles/service";
import { listMyBrands } from "@/lib/profiles/brands";
import { likelySizes, sizeOptionsByCategory } from "@/lib/profiles/sizes";
import { canSeeBodyData } from "@/lib/people/visibility";
import { resolveProfileTarget } from "../target";
import { FavoritesEditor } from "./favorites-editor";

export const metadata = { title: "Favorite brands & stores" };
export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const { viewer, owner, mine, canEdit } = await resolveProfileTarget();
  const seeBody = await canSeeBodyData(viewer, owner.id);
  // Sizes are body data: listMyBrands leaves them out for a viewer who may not see them, and the section is hidden (review E A1).
  const [favs, brands, stores, myBrands, sizeOptions, likely] = await Promise.all([
    getFavorites(owner.id),
    db.brand.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.store.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    listMyBrands(viewer, owner.id),
    sizeOptionsByCategory(),
    seeBody ? likelySizes(owner.id) : Promise.resolve(null),
  ]);

  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title={mine ? "Brands" : owner.first} accent={mine ? "& stores" : "brands"} />
      <FavoritesEditor ownerId={owner.id} ownerFirst={owner.first} mine={mine} favs={favs} brands={brands} stores={stores} myBrands={myBrands} sizeOptions={sizeOptions} likely={likely} canEdit={canEdit} canSeeSizes={seeBody} canEditLists={viewer.role === "admin"} />
    </div>
  );
}
