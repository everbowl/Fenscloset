import Link from "next/link";

export function Forbidden() {
  return (
    <div className="flex flex-col gap-3 py-10">
      <h1 className="serif text-[34px]">Admins <em>only</em></h1>
      <p className="text-[15px] leading-snug text-graphite">This area is for family admins. Ask Jeff or Brittney if you need something changed.</p>
      <Link href="/today" className="mono mono-11 py-2.5 underline underline-offset-4">Back to today</Link>
    </div>
  );
}
