import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export function Forbidden() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <ShieldAlert className="mb-3 size-9 text-stone-400" />
      <h1 className="text-xl font-semibold">Admins only</h1>
      <p className="mt-2 max-w-xs text-sm text-muted">This area is for family admins. Ask Jeff or Brittney if you need something changed.</p>
      <Link href="/today" className="mt-5 text-sm font-medium text-accent">Back to Today</Link>
    </div>
  );
}
