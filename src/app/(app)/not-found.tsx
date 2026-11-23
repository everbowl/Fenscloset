import Link from "next/link";

/** A page or a piece that isn't there (deleted, or a link typed wrong), inside the shell. */
export default function AppNotFound() {
  return (
    <div className="flex flex-col items-start gap-4 pt-6" data-testid="app-not-found">
      <p className="caption">Not here</p>
      <h1 className="title">Nothing on this hanger</h1>
      <p className="note max-w-sm">That page or piece isn’t in the closet any more.</p>
      <div className="mt-2 flex gap-2">
        <Link href="/closet" className="pill pill-solid h-[50px] px-6">Open the closet</Link>
        <Link href="/today" className="pill h-[50px] px-6">Go to Today</Link>
      </div>
    </div>
  );
}
