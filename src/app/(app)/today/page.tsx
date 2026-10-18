import { requirePerson } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Today" };

function titleFor(date: Date) {
  const h = date.getHours();
  return h >= 16 ? { title: "Tonight’s", accent: "look" } : { title: "Today’s", accent: "look" };
}

export default async function TodayPage() {
  await requirePerson();
  const now = new Date();
  const t = titleFor(now);
  const eyebrow = now.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short" }).replace(",", "");
  return (
    <div>
      <PageHeader eyebrow={`${eyebrow} · weather and plans arrive in phase 3`} title={t.title} accent={t.accent} aside="00 / 03" />
      <div className="grid grid-cols-2 grid-rows-[196px_196px] gap-1.5">
        <div className="row-span-2 bg-bone" />
        <div className="bg-bone" />
        <div className="grid grid-cols-2 gap-1.5"><div className="bg-bone" /><div className="bg-bone" /></div>
      </div>
      <div className="mt-3.5 flex flex-col gap-1">
        <p className="mono text-graphite">No looks yet</p>
        <p className="serif text-[21px] italic leading-[1.3]">Add clothes with the + button and your first three looks will appear here.</p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Button size="lg" className="w-full tracking-[0.18em]" disabled>Wear this</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled>Swap one piece</Button>
          <Button variant="secondary" disabled>More looks</Button>
        </div>
      </div>
    </div>
  );
}
