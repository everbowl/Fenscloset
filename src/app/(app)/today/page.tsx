import { requirePerson } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Sun } from "lucide-react";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const person = await requirePerson();
  const first = person.name.split(" ")[0];
  return (
    <div>
      <PageHeader title={`Hi ${first}`} subtitle="Your outfits for today will live here." />
      <EmptyState icon={<Sun className="size-8" />} title="Outfit suggestions arrive in Phase 3" body="Once your closet has clothes in it, this page will show three outfits for today's weather and plans." />
    </div>
  );
}
