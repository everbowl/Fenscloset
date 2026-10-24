/**
 * Next.js runs this once when the server starts. One-time background work that must never sit inside a page load
 * goes here: the Tidy and Smooth revert (src/lib/items/untidy.ts) pays remove.bg per piece and can take minutes.
 * UNTIDY_ON_START=false skips it (end-to-end tests, screenshot runs).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.UNTIDY_ON_START === "false") return;
  const { untidyOnStart } = await import("@/lib/items/untidy");
  void untidyOnStart();
}
