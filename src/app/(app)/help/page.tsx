import Link from "next/link";
import { isAdmin, requirePerson } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { HELP_TOPICS } from "./content";
import { CueTile } from "./cues";
import { stepsFor } from "./steps";

export const metadata = { title: "Help" };
export const dynamic = "force-dynamic";

/** Screen 20: Help. A grid of topics (like the closet grid) so nobody faces a wall of words; each topic opens its own short page. */
export default async function HelpPage() {
  const person = await requirePerson();
  const topics = HELP_TOPICS.filter((t) => !t.adminOnly || isAdmin(person));
  const counts = await Promise.all(topics.map((t) => stepsFor(t, person.id).then((s) => s.length)));
  return (
    <div data-testid="help">
      <PageHeader eyebrow="How to use Fen’s Closet" title="Like you’re" accent="five" aside={`${topics.length} topics`} />
      <p className="serif text-[21px] italic leading-[1.3] lg:max-w-[640px]">Big buttons at the bottom. Your name at the top left. Pick what you want to do.</p>
      <ul className="mt-6 grid grid-cols-2 gap-x-[10px] gap-y-[18px] lg:grid-cols-3">
        {topics.map((t, i) => (
          <li key={t.slug}>
            <Link href={`/help/${t.slug}`} className="block" data-testid={`help-topic-${t.slug}`}>
              <CueTile cue={t.cover} className="h-[120px] lg:h-[150px]" />
              <p className="serif mt-2 text-[26px] leading-none">{t.title} <em>{t.accent}</em></p>
              <p className="mono mt-1.5 text-graphite">{counts[i]} steps · {t.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mono mt-8 border-t border-ink pt-4 text-graphite">Stuck? Tell Jeff what you tapped and what you saw.</p>
    </div>
  );
}
