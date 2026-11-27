import Link from "next/link";
import { isAdmin } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { logoutAction } from "@/app/(auth)/login/actions";
import { db } from "@/lib/db";
import { canSeeBodyData } from "@/lib/people/visibility";
import { getBodyProfile, getFavorites, getStyleProfile } from "@/lib/profiles/service";
import { resolveProfileTarget } from "./target";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const roleLabel = { admin: "Admin", member: "Member", minor: "Minor" } as const;

/** One destination: where it goes, what it is for, and what is in it now. A row with no link is a locked one. */
function Row({ href, label, blurb, meta, testId }: { href?: string; label: string; blurb: string; meta?: string; testId?: string }) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold leading-tight">{label}</span>
        <span className="note mt-0.5 block text-[14px]">{blurb}</span>
        {meta ? <span className="caption mt-1 block truncate text-ink">{meta}</span> : null}
      </span>
      {href ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="shrink-0 text-graphite"><path d="m9 6 6 6-6 6" /></svg> : <span className="caption shrink-0">Private</span>}
    </>
  );
  const cls = "card flex min-h-[72px] items-center gap-3 px-4 py-3";
  return href
    ? <Link href={href} data-testid={testId} className={`${cls} tap`}>{inner}</Link>
    : <div data-testid={testId} className={`${cls} opacity-80`} aria-disabled="true">{inner}</div>;
}

/** The profile hub: every place under a person, one card each, so "where do I go for…" answers itself. */
export default async function ProfilePage() {
  const { viewer, owner, mine } = await resolveProfileTarget();
  const seeBody = await canSeeBodyData(viewer, owner.id);
  const [body, style, favs, words, brands, stores, email] = await Promise.all([
    seeBody ? getBodyProfile(viewer, owner.id) : null,
    getStyleProfile(owner.id),
    getFavorites(owner.id),
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
  const bodyMeta = !seeBody ? undefined : measured || body?.sizes.length ? `${measured} measured · ${body!.sizes.length} sizes` : "Not filled in";
  const styleMeta = names(words, style.styleWordIds) ?? (style.lovedColorIds.length ? `${style.lovedColorIds.length} loved colors` : "Not filled in");
  const favMeta = [names(brands, favs.brandIds, 2), names(stores, favs.storeIds, 1)].filter(Boolean).join(" · ") || "None yet";
  const you = mine ? "you" : owner.first;
  const your = mine ? "your" : `${owner.first}'s`;

  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title={owner.first} aside={roleLabel[owner.role]} />
      <p className="caption -mt-2 mb-4">{mine ? email.email ?? "No email yet" : `${owner.first}'s profile`}</p>
      <div className="flex flex-col gap-2.5">
        <Row href={seeBody ? "/profile/body" : undefined} label="Body" blurb={seeBody ? `Measurements, sizes, fit notes and full-body photos. Only ${you}${owner.role === "minor" ? " and parents" : ""} see them.` : `${owner.first}'s measurements and sizes stay with ${owner.first}${owner.role === "minor" ? " and parents" : ""}.`} meta={bodyMeta} testId="row-body" />
        <Row href="/profile/brands" label="Brands & stores" blurb={`${mine ? "Your" : `${owner.first}'s`} brands, the size in each, and where ${you} like${mine ? "" : "s"} to buy. The Shop leans on these.`} meta={favMeta} testId="row-brands" />
        <Row href="/profile/style" label="Style" blurb={`Colors ${you} love${mine ? "" : "s"} and avoid${mine ? "" : "s"}, style words, looks to dress like. The suggestions follow this.`} meta={styleMeta} testId="row-style" />
        {mine ? <Row href="/profile/settings" label="Settings" blurb="Zip for the weather, who sees your body profile, who may shop for you, try-on, Google Calendar, password." testId="row-settings" /> : null}
        {mine && isAdmin(viewer) ? <Row href="/admin/people" label="Admin" blurb="People and invites, every editable list, and the household rules." testId="row-admin" /> : null}
        {mine ? <Row href="/help" label="Help" blurb="How each screen works, one step at a time, with a picture of the thing to tap." testId="row-help" /> : null}
      </div>
      {!mine ? <p className="caption mt-4">{`This is ${your} profile. Tap ${owner.first}'s name at the top to switch back to yours.`}</p> : null}
      {mine ? (
        <form action={logoutAction} className="mt-8">
          <button type="submit" className="pill pill-quiet h-[50px] w-full" data-testid="log-out">Log out</button>
        </form>
      ) : null}
    </div>
  );
}
