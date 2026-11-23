import { PageHeader } from "@/components/ui/page-header";
import { bodyViewerNames, getBodyProfile } from "@/lib/profiles/service";
import { likelySizes } from "@/lib/profiles/sizes";
import { resolveProfileTarget } from "../target";
import { BodyEditor } from "./body-editor";

export const metadata = { title: "Body profile" };
export const dynamic = "force-dynamic";

export default async function BodyProfilePage() {
  const { viewer, owner, mine, canEdit } = await resolveProfileTarget();
  const body = await getBodyProfile(viewer, owner.id);
  if (!body) {
    return (
      <div className="lg:max-w-[640px]">
        <PageHeader title={owner.first} accent="body" />
        <div className="card p-4">
          <p className="text-[17px] font-semibold">{owner.first}&apos;s body profile is private</p>
          <p className="note mt-1">{owner.role === "minor" ? `Only ${owner.first} and their parents see it.` : `Only ${owner.first} sees it, plus the people ${owner.first} chose in Settings.`}</p>
        </div>
      </div>
    );
  }
  const [viewers, likely] = await Promise.all([bodyViewerNames(owner.id), likelySizes(owner.id)]);
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title={mine ? "Body" : owner.first} accent="profile" />
      <BodyEditor ownerId={owner.id} ownerFirst={owner.first} isMinor={owner.role === "minor"} body={{ ...body, photos: body.photos.map((p) => ({ ...p, takenAt: p.takenAt.toISOString() })) }} likely={likely} canEdit={canEdit} canEditLists={viewer.role === "admin"} visibleTo={viewers} />
    </div>
  );
}

