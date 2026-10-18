import Link from "next/link";
import { isAdmin } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/login/actions";
import { db } from "@/lib/db";
import { canSeeBodyData } from "@/lib/people/visibility";
import { getBodyProfile, getFavorites, getStyleProfile } from "@/lib/profiles/service";
import { resolveProfileTarget } from "./target";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const roleLabel = { admin: "Admin", member: "Member", minor: "Minor" } as const;

function Row({ href, label, meta, testId }: { href?: string; label: string; meta?: string; testId?: string }) {
  const inner = (
    <>
      <span className="text-[15px]">{label}</span>
      <span className="mono ml-4 shrink-0 truncate text-right text-graphite">{meta ?? "→"}</span>
    </>
  );
  return href
    ? <Link href={href} data-testid={testId} className="flex h-12 items-center justify-between border-b border-line">{inner}</Link>
    : <div data-testid={testId} className="flex h-12 items-center justify-between border-b border-line">{inner}</div>;
}

export default async function ProfilePage() {
  const { viewer, owner, mine } = await resolveProfileTarget();
  const seeBody = await canSeeBodyData(viewer, owner.id);
  const [body, style, favs, colors, words, brands, stores, email] = await Promise.all([
    seeBody ? getBodyProfile(viewer, owner.id) : null,
    getStyleProfile(owner.id),
    getFavorites(owner.id),
    db.color.findMany({ select: { id: true, name: true } }),
    db.styleWord.findMany({ select: { id: true, name: true } }),
    db.brand.findMany({ select: { id: true, name: true } }),
    db.store.findMany({ select: { id: true, name: true } }),
    db.person.findUniqueOrThrow({ where: { id: owner.id }, select: { email: true } }),
  ]);
  const names = (xs: { id: string; name: string }[], ids: string[], max = 3) => {
    const n = ids.map((id) => xs.find((x) => x.id === id)?.name).filter(Boolean) as string[];
    return n.length ? n.slice(0, max).join(", ") + (n.length > max ? ` +${n.length - max}` : "") : null;
  };
  const measured = body ? body.measurements.filter((m) => m.value).length : 0;
  const bodyMeta = !seeBody ? "Private" : measured || body?.sizes.length ? `${measured} measured · ${body!.sizes.length} sizes` : "Not filled in";
  const styleMeta = names(words, style.styleWordIds) ?? (style.lovedColorIds.length ? `${style.lovedColorIds.length} loved colours` : "Not filled in");
  const favMeta = [names(brands, favs.brandIds, 2), names(stores, favs.storeIds, 1)].filter(Boolean).join(" · ") || "None yet";

  return (
    <div>
      <PageHeader title={owner.first} aside={roleLabel[owner.role]} />
      <p className="mono normal-case text-graphite -mt-2 mb-4">{mine ? email.email ?? "No email yet" : `${owner.first}'s profile`}</p>
      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">{mine ? "You" : owner.first}</p>
        <Row href={seeBody ? "/profile/body" : undefined} label="Body profile" meta={bodyMeta} testId="row-body" />
        <Row href="/profile/style" label="Style profile" meta={styleMeta} />
        <Row href="/profile/brands" label="Favorite brands & stores" meta={favMeta} />
        {mine ? <Row href="/profile/settings" label="Settings & privacy" /> : null}
        {mine ? <Row href="/change-password" label="Change password" /> : null}
      </section>
      {mine && isAdmin(viewer) ? (
        <section className="mt-7">
          <p className="mono border-b border-ink pb-2 text-graphite">Admin</p>
          <Row href="/admin/people" label="People" />
          <Row href="/admin/lists" label="Lists" />
          <Row href="/admin/rules" label="Rules" />
        </section>
      ) : null}
      {mine ? (
        <form action={logoutAction} className="mt-8">
          <Button type="submit" variant="secondary" className="w-full">Log out</Button>
        </form>
      ) : null}
      {!mine && !seeBody ? <p className="mono mt-6 text-graphite">{owner.first}&apos;s body profile is private</p> : null}
    </div>
  );
}
