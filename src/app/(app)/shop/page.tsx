import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ShoppingBag } from "lucide-react";

export const metadata = { title: "Shop" };

export default function ShopPage() {
  return (
    <div>
      <PageHeader title="Shop" />
      <EmptyState icon={<ShoppingBag className="size-8" />} title="Coming in Phase 4" body="Paste a link, drop a screenshot, or snap a dressing-room photo for a fit verdict and outfit pairings." />
    </div>
  );
}
