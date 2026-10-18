import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Shop" };

export default function ShopPage() {
  return (
    <div>
      <PageHeader title="Shop" />
      <EmptyState title="Coming in phase 4" body="Paste a link, drop a screenshot, or snap a dressing-room photo for a fit verdict and outfit pairings." className="h-[380px]" />
    </div>
  );
}
