import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Camera } from "lucide-react";

export const metadata = { title: "Add" };

export default function AddPage() {
  return (
    <div>
      <PageHeader title="Add clothes" />
      <EmptyState icon={<Camera className="size-8" />} title="Coming in Phase 1" body="Pick a batch of photos, and the app will cut out backgrounds and tag each item for you." />
    </div>
  );
}
