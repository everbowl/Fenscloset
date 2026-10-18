import Link from "next/link";
import { requirePerson } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Help" };
export const dynamic = "force-dynamic";

/** Screen 20: the "how to use it" guide, written like you're five. One idea per step, one action per line. */
const SECTIONS: { title: string; accent: string; steps: string[]; link?: { href: string; label: string } }[] = [
  { title: "Add your", accent: "clothes", link: { href: "/add", label: "Open Add" }, steps: [
    "Tap the big + at the bottom.",
    "Tap PICK PHOTOS and choose lots of photos at once. One piece of clothing per photo, on a hanger or laid flat.",
    "Wait. The app cuts out the background and guesses what each piece is.",
    "For each piece you see a card. If the tags look right, tap LOOKS RIGHT · NEXT. If not, tap the wrong row and pick the right word.",
    "If it says LOOKS LIKE ONE YOU OWN, tap SAME? if it really is the same piece.",
    "You can close the app any time. The pile waits for you.",
  ] },
  { title: "See your", accent: "closet", link: { href: "/closet", label: "Open Closet" }, steps: [
    "Tap CLOSET at the bottom.",
    "Tap a word at the top (TOPS, SHOES…) to see only those.",
    "Tap a piece to open it. Tap IN THE WASH? when it's dirty so the app stops suggesting it.",
    "Tap your name at the top left to look at someone else's closet, or the whole FAMILY closet.",
  ] },
  { title: "Get dressed", accent: "today", link: { href: "/today", label: "Open Today" }, steps: [
    "Tap TODAY at the bottom. The first time, tap ENTER ZIP so it knows your weather.",
    "Tap CHECK-IN (top right) and tap how you look today, or take a selfie. Only you (and a parent, for kids) can see the selfie.",
    "Tap EDIT next to the date to say what the plan is (dinner, gym, school…). If your Google Calendar is connected, it already knows.",
    "Swipe sideways to see the three looks.",
    "Tap WEAR THIS when you've picked. Tap SWAP ONE PIECE to change one thing. Tap MORE LOOKS for three new ones.",
  ] },
  { title: "Dress", accent: "together", link: { href: "/today/together", label: "Open Together" }, steps: [
    "On Today, tap GOING OUT TOGETHER?",
    "Tap the people coming. Tap COORDINATE (same mood), MATCH (same colors), or CONTRAST (different on purpose).",
    "Tap DRESS US. Everyone gets a look. Each person taps their own WEAR THIS (parents can tap for kids).",
  ] },
  { title: "Your", accent: "fits", link: { href: "/fits", label: "Open Fits" }, steps: [
    "Tap FITS at the bottom. Every day you tapped WEAR THIS shows up on the calendar.",
    "Tap a day to see what you wore. Tap ADD PHOTO to add a picture from that night.",
    "Tap SHARE to pick who can see it. The line under the photo always says who can.",
    "Forgot to tap WEAR THIS? Tap that day, tap SAVE THE FIT, and pick the pieces.",
  ] },
  { title: "Should I", accent: "buy it?", link: { href: "/shop", label: "Open Shop" }, steps: [
    "Tap SHOP at the bottom.",
    "Tap PASTE A LINK and paste the store link, or tap SCREENSHOT, or tap TAKE A PHOTO in the dressing room.",
    "Read the verdict: FITS, RISKY, or PASS, with one reason.",
    "Look at WEAR IT WITH to see three ways to wear it with clothes you already own.",
    "Shopping for someone else? Tap SHOPPING FOR at the top. You can shop for your kids, or anyone who allowed it in their Settings.",
  ] },
  { title: "Your", accent: "profile", link: { href: "/profile", label: "Open Profile" }, steps: [
    "Tap your name at the top left, then PROFILE.",
    "BODY: your sizes and measurements. Only you can see them, plus parents for kids, plus anyone you choose in Settings.",
    "Body photos: when you add one, pick ONLY ME to keep it to yourself. The app can still use it to dress you.",
    "STYLE: colors you love, colors you avoid, words that describe you. The looks follow this.",
    "BRANDS & STORES: your favorites. Shopping picks lean on these.",
    "SETTINGS: your zip, who can see your body profile, who can shop for you, Google Calendar.",
  ] },
  { title: "Clean", accent: "out", link: { href: "/closet/clean-out", label: "Open Clean-out" }, steps: [
    "When Today shows TIME FOR A CLEAN-OUT?, tap it.",
    "Each piece hasn't been worn in a while. Tap KEEP to hide it for 3 months, DONATE or SELL to retire it.",
    "Retired pieces keep their history. Open one from the closet and tap BRING IT BACK if you change your mind.",
  ] },
  { title: "For", accent: "admins", link: { href: "/admin/people", label: "Open Admin" }, steps: [
    "Tap your name, then PEOPLE to invite family (email or text), set roles, and link kids to parents.",
    "LISTS: every word the app uses (categories, colors, occasions, check-in answers…) lives here. You can also tap EDIT wherever a list shows up.",
    "RULES: how many days before a piece can repeat, how many months before clean-out, and the household time zone.",
    "A kid's body photos need a parent's OK on their People page. Turning it off deletes the photos.",
  ] },
];

export default async function HelpPage() {
  await requirePerson();
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader eyebrow="How to use Fen’s Closet" title="Like you’re" accent="five" />
      <p className="serif text-[21px] italic leading-[1.3]">Big buttons at the bottom. Your name at the top left. Everything else is one tap away.</p>
      <div className="mt-6 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title + s.accent} className="border-t border-ink pt-4">
            <div className="flex items-end justify-between">
              <h2 className="serif text-[30px] leading-none">{s.title} <em>{s.accent}</em></h2>
              {s.link ? <Link href={s.link.href} className="mono mono-11 shrink-0 py-2">{s.link.label}</Link> : null}
            </div>
            <ol className="mt-3 space-y-2.5">
              {s.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-snug">
                  <span className="mono mt-[3px] w-5 shrink-0 text-graphite">{String(i + 1).padStart(2, "0")}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <p className="mono mt-8 border-t border-ink pt-4 text-graphite">Stuck? Tell Jeff what you tapped and what you saw.</p>
    </div>
  );
}
