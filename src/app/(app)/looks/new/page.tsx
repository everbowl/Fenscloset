import { redirect } from "next/navigation";
import { requirePerson } from "@/lib/auth/current";
import { openOrStartLook } from "@/lib/looks/service";

export const dynamic = "force-dynamic";

/** "+ New look" under Fits: the person's open look, started when there is none. */
export default async function NewLookPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const me = await requirePerson();
  const { for: forId } = await searchParams;
  const id = await openOrStartLook(me, forId && /^[a-z0-9]{10,40}$/.test(forId) ? forId : me.id);
  redirect(`/looks/${id}`);
}
