import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { getPerson, listPeople } from "@/lib/people/service";
import { smsConfigured } from "@/lib/sms";
import { requireAdmin } from "@/lib/auth/current";
import { PersonEditor } from "./person-editor";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const person = await getPerson(id);
  if (!person || person.status === "removed") notFound();
  const admins = (await listPeople()).filter((p) => p.role === "admin").map((p) => ({ id: p.id, name: p.name }));
  return (
    <div>
      <Link href="/admin/people" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"><ChevronLeft className="size-4" /> People</Link>
      <PageHeader title={person.name} />
      <PersonEditor person={person} admins={admins} smsReady={smsConfigured()} isSelf={person.id === admin.id} />
    </div>
  );
}
