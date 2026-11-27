import Link from "next/link";
import { isAdmin, requirePerson } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { HELP_TOPICS } from "./content";
import { CueTile } from "./cues";
import { stepsFor } from "./steps";

export const metadata = { title: "Help" };
export const dynamic = "force-dynamic";

/** Screen 20: Help. A grid of topic cards (like the closet grid) so nobody faces a wall of words; each topic opens its own short page. */
export default async function HelpPage() {
  const person = await requirePerson();
  const topics = HELP_TOPICS.filter((t) => !t.adminOnly || isAdmin(person));
  const counts = await Promise.all(topics.map((t) => stepsFor(t, person.id).then((s) => s.length)));
  return (
    <div data-testid="help">
      <PageHeader eyebrow="How to use Fen’s Closet" title="Like you’re" accent="five" aside={`${topics.length} topics`} />
      <p className="note text-ink text-[16px] lg:max-w-[640px]">Big buttons at the bottom. Your name at the top left. Pick what you want to do.</p>
      <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {topics.map((t, i) => (
          <li key={t.slug}>
            <Link href={`/help/${t.slug}`} className="card tap block overflow-hidden p-0" data-testid={`help-topic-${t.slug}`}>
              <CueTile cue={t.cover} className="h-[120px] rounded-none lg:h-[150px]" />
              <span className="block p-3">
                <span className="block text-[17px] font-semibold leading-tight">{t.title} {t.accent}</span>
                <span className="note mt-1 block text-[14px]">{counts[i]} steps. {t.blurb}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="note mt-8">Stuck? Tell an admin what you tapped and what you saw.</p>
    </div>
  );
}
