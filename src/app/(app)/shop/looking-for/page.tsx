import { requirePerson } from "@/lib/auth/current";
import { shoppingFor } from "@/lib/shop/people";
import { rememberedShopFor } from "@/lib/shop/remember";
import { listWants } from "@/lib/shop/wants";
import { LookingForScreen } from "./looking-for-screen";

export const metadata = { title: "Looking for" };
export const dynamic = "force-dynamic";

/** Shop v2 item 2 (Jeff, 23 Oct 2026): the lines a person is looking for, each searched now and again every day, with what is new. */
export default async function LookingForPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const me = await requirePerson();
  const { for: forParam } = await searchParams;
  const { people, forPersonId } = await shoppingFor(me, forParam ?? (await rememberedShopFor()));
  const wants = await listWants(me, forPersonId);
  return <LookingForScreen meId={me.id} people={people} forPersonId={forPersonId} wants={wants} />;
}
