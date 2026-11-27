import Link from "next/link";

export function Forbidden() {
  return (
    <div className="flex flex-col items-start gap-4 py-8">
      <h1 className="title">Admins only</h1>
      <p className="note max-w-sm">This area is for family admins. Ask Jeff or Brittney if you need something changed.</p>
      <Link href="/today" className="pill pill-solid h-12 px-6">Back to today</Link>
    </div>
  );
}
