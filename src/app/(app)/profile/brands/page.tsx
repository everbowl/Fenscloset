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
  const [favs, brands, stores, myBrands, sizeOptions, likely] = await Promise.all([
    getFavorites(owner.id),
    db.brand.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.store.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    listMyBrands(owner.id),
    sizeOptionsByCategory(),
    (async () => ((await canSeeBodyData(viewer, owner.id)) ? likelySizes(owner.id) : null))(),
  ]);

  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title={mine ? "Brands" : owner.first} accent={mine ? "& stores" : "brands"} />
      <FavoritesEditor ownerId={owner.id} favs={favs} brands={brands} stores={stores} myBrands={myBrands} sizeOptions={sizeOptions} likely={likely} canEdit={canEdit} canEditLists={viewer.role === "admin"} />
    </div>
  );
}
