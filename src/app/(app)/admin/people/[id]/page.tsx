import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getPerson, listPeople } from "@/lib/people/service";
import { smsConfigured } from "@/lib/sms";
import { requireAdmin } from "@/lib/auth/current";
import { PersonEditor } from "./person-editor";
import { bodyPhotosAllowed } from "@/lib/people/visibility";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const person = await getPerson(id);
  if (!person || person.status === "removed") notFound();
  const admins = (await listPeople()).filter((p) => p.role === "admin").map((p) => ({ id: p.id, name: p.name }));
  const bodyPhotos = person.role === "minor" ? await bodyPhotosAllowed(person.id) : null;
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title={person.name} />
      <PersonEditor person={person} admins={admins} smsReady={smsConfigured()} isSelf={person.id === admin.id} bodyPhotos={bodyPhotos ? { allowed: bodyPhotos.allowed, approvedBy: bodyPhotos.approvedBy ?? null, isParent: person.guardianIds.includes(admin.id) } : null} />
    </div>
  );
}
