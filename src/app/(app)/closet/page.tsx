import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Shirt } from "lucide-react";

export const metadata = { title: "Closet" };

export default function ClosetPage() {
  return (
    <div>
      <PageHeader title="Closet" />
      <EmptyState icon={<Shirt className="size-8" />} title="Your closet is empty" body="Adding clothes arrives in Phase 1. Tap Add to start when it's ready." />
    </div>
  );
}
