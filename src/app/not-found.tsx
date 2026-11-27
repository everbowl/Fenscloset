/** A page that isn't there, outside the shell (signed out, or a link typed wrong). */
export default function RootNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-start justify-center gap-4 px-6">
      <p className="caption">Not here</p>
      <h1 className="title">Nothing on this hanger</h1>
      <p className="note max-w-sm">That page isn’t in the closet.</p>
      <a href="/today" className="pill pill-solid mt-2 h-[50px] px-6">Go to Today</a>
    </main>
  );
}
