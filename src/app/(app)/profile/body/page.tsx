import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { getBodyProfile } from "@/lib/profiles/service";
import { likelySizes, sizeOptionsByCategory } from "@/lib/profiles/sizes";
import { resolveProfileTarget } from "../target";
import { BodyEditor } from "./body-editor";

export const metadata = { title: "Body profile" };
export const dynamic = "force-dynamic";

export default async function BodyProfilePage() {
  const { viewer, owner, mine, canEdit } = await resolveProfileTarget();
  const body = await getBodyProfile(viewer, owner.id);
  if (!body) {
    return (
      <div>
        <Link href="/profile" className="mono mb-3 inline-block text-graphite">← Profile</Link>
        <PageHeader title="Body" accent="profile" />
        <p className="mono text-graphite">{owner.first}&apos;s body profile is private</p>
      </div>
    );
  }
  const [brands, categories, viewers, sizeOptions, likely] = await Promise.all([
    db.brand.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.category.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    viewerNames(owner.id),
    sizeOptionsByCategory(),
    likelySizes(owner.id),
  ]);
  return (
    <div>
      <Link href="/profile" className="mono mb-3 inline-block text-graphite">← Profile</Link>
      <PageHeader title={mine ? "Body" : owner.first} accent="profile" />
      <BodyEditor ownerId={owner.id} ownerFirst={owner.first} isMinor={owner.role === "minor"} body={{ ...body, photos: body.photos.map((p) => ({ ...p, takenAt: p.takenAt.toISOString() })) }} brands={brands} categories={categories} sizeOptions={sizeOptions} likely={likely} canEdit={canEdit} canEditLists={viewer.role === "admin"} visibleTo={viewers} />
    </div>
  );
}

/** "VISIBLE TO JEFF, BRITTNEY" line: owner, parents, and granted viewers. */
async function viewerNames(ownerId: string): Promise<string[]> {
  const [owner, parents, grants] = await Promise.all([
    db.person.findUniqueOrThrow({ where: { id: ownerId }, select: { name: true } }),
    db.guardianLink.findMany({ where: { minorId: ownerId }, include: { parent: { select: { name: true } } } }),
    db.bodyDataGrant.findMany({ where: { ownerId }, include: { viewer: { select: { name: true } } } }),
  ]);
  return [owner.name, ...parents.map((p) => p.parent.name), ...grants.map((g) => g.viewer.name)].map((n) => n.split(" ")[0]);
}
