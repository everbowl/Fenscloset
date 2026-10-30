/** A page that isn't there, outside the shell (signed out, or a link typed wrong). */
export default function RootNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-start justify-center gap-4 px-6">
      <p className="mono text-graphite">Not here</p>
      <h1 className="serif text-[44px] leading-none">Nothing on <em>this hanger</em></h1>
      <p className="max-w-sm text-[15px] leading-snug text-graphite">That page isn’t in the closet.</p>
      <a href="/today" className="pill pill-solid mt-2 h-[50px] px-6">Go to Today</a>
    </main>
  );
}
