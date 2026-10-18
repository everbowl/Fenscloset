import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Add clothes" };

export default function AddPage() {
  return (
    <div>
      <PageHeader title="Add" accent="clothes" />
      <EmptyState title="Coming in phase 1" body="Pick a batch of photos. The app cuts out the background, tags each piece, and asks you to confirm with one tap." className="h-[380px]" />
    </div>
  );
}
