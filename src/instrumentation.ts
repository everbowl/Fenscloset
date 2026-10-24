/**
 * Next.js runs this once when the server starts. Background work that must never sit inside a page load goes here:
 * the Tidy and Smooth revert (src/lib/items/untidy.ts) pays remove.bg per piece and can take minutes; the Looking-for
 * sweep (src/lib/shop/wants.ts) searches the stores again for each want on the schedule in Admin → Rules.
 * UNTIDY_ON_START=false / WANTS_ON_START=false skip them (end-to-end tests, screenshot runs).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.UNTIDY_ON_START !== "false") {
    const { untidyOnStart } = await import("@/lib/items/untidy");
    void untidyOnStart();
  }
  if (process.env.WANTS_ON_START !== "false") {
    const { wantsOnStart } = await import("@/lib/shop/wants");
    void wantsOnStart();
  }
}
