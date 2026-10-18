import { requirePerson } from "@/lib/auth/current";
import { isProductSearchConfigured } from "@/lib/shop/products";
import { StoreScreen } from "./store-screen";

export const metadata = { title: "Add from a store" };
export const dynamic = "force-dynamic";

export default async function AddFromStorePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePerson();
  const { tab } = await searchParams;
  return <StoreScreen canSearch={isProductSearchConfigured()} initialTab={tab === "receipt" ? "receipt" : "link"} />;
}
