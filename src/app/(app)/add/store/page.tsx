import { requirePerson } from "@/lib/auth/current";
import { isProductSearchConfigured } from "@/lib/shop/products";
import { StoreScreen } from "./store-screen";

export const metadata = { title: "Add from a store" };
export const dynamic = "force-dynamic";

export default async function AddFromStorePage() {
  await requirePerson();
  return <StoreScreen canSearch={isProductSearchConfigured()} />;
}
