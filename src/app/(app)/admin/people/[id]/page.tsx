import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { CrumbLabel } from "@/components/crumbs";
import { listPeople } from "@/lib/people/service";
import { smsConfigured } from "@/lib/sms";
import { requireAdmin } from "@/lib/auth/current";
import { PersonEditor } from "./person-editor";
import { bodyPhotosAllowed } from "@/lib/people/visibility";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  // One list serves both the person and the admins; the body-photo rule loads alongside (review A P2).
  const [people, bodyPhotos] = await Promise.all([listPeople({ includeRemoved: true }), bodyPhotosAllowed(id)]);
  const person = people.find((p) => p.id === id);
  if (!person || person.status === "removed") notFound();
  const admins = people.filter((p) => p.role === "admin" && p.status !== "removed").map((p) => ({ id: p.id, name: p.name }));
  return (
    <div className="lg:max-w-[640px]">
      <CrumbLabel label={person.name} />
      <PageHeader title={person.name} />
      <PersonEditor person={person} admins={admins} smsReady={smsConfigured()} isSelf={person.id === admin.id}
        bodyPhotos={person.role === "minor" ? { allowed: bodyPhotos.allowed, approvedBy: bodyPhotos.approvedBy ?? null, isParent: person.guardianIds.includes(admin.id) } : null} />
    </div>
  );
}
