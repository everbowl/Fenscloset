import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requirePerson } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { findTopic, HELP_TOPICS } from "../content";
import { CueTile } from "../cues";
import { stepsFor } from "../steps";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const topic = findTopic((await params).slug);
  return { title: topic ? `Help · ${topic.title} ${topic.accent}` : "Help" };
}

/** One help topic: each step is a picture of the exact thing to tap, then the words. */
export default async function HelpTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const person = await requirePerson();
  const topic = findTopic((await params).slug);
  if (!topic || (topic.adminOnly && !isAdmin(person))) notFound();
  const steps = await stepsFor(topic, person.id);
  const visible = HELP_TOPICS.filter((t) => !t.adminOnly || isAdmin(person));
  const i = visible.findIndex((t) => t.slug === topic.slug);
  const next = visible[i + 1];
  return (
    <div className="lg:max-w-[640px]" data-testid="help-topic">
      <PageHeader title={topic.title} accent={topic.accent} action={<Link href={topic.link.href} className="mono mono-11 inline-flex h-11 items-center whitespace-nowrap">{topic.link.label}</Link>} />
      <ol className="border-t border-ink">
        {steps.map((step, n) => (
          <li key={n} className="flex items-center gap-4 border-b border-line py-4">
            <CueTile cue={step.cue} className="h-[72px] w-[120px] shrink-0" />
            <div className="min-w-0">
              <span className="mono text-graphite">{String(n + 1).padStart(2, "0")}</span>
              <p className="mt-1 text-[15px] leading-snug">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex items-center justify-between">
        <Link href="/help" className="mono mono-11 inline-flex h-11 items-center text-graphite">All topics</Link>
        {next ? <Link href={`/help/${next.slug}`} className="mono mono-11 inline-flex h-11 items-center">Next: {next.title} {next.accent} →</Link> : null}
      </div>
    </div>
  );
}
