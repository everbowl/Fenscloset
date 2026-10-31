import type { Cue } from "./cues";

export type HelpStep = { text: string; cue: Cue };
export type HelpTopic = {
  slug: string; title: string; accent: string; blurb: string; adminOnly?: boolean;
  link: { href: string; label: string }; cover: Cue; steps: HelpStep[];
};

/** Screen 20: the "how to use it" guide, written like you're five. One idea per step, one action per line, one picture of the thing to tap. */
export const HELP_TOPICS: HelpTopic[] = [
  { slug: "add", title: "Add your", accent: "clothes", blurb: "Photos in, tagged pieces out.", link: { href: "/add", label: "Open Add" }, cover: { kind: "plus" }, steps: [
    { text: "Tap the big +. On a phone it sits at the bottom; on a computer, in the row under the name.", cue: { kind: "plus" } },
    { text: "Tap PICK PHOTOS and choose lots of photos at once. One piece of clothing per photo, on a hanger or laid flat.", cue: { kind: "button", label: "Pick photos" } },
    { text: "Wait. The app cuts out the background and guesses what each piece is.", cue: { kind: "wait" } },
    { text: "For each piece you see a card. If the tags look right, tap LOOKS RIGHT · NEXT. If not, tap the wrong row and pick the right word.", cue: { kind: "button", label: "Looks right · next" } },
    { text: "If it says LOOKS LIKE ONE YOU OWN, tap SAME? if it really is the same piece.", cue: { kind: "strip", label: "Looks like one you own · Same?" } },
    { text: "You can close the app any time. The pile waits for you.", cue: { kind: "link", label: "× Close" } },
  ] },
  { slug: "closet", title: "See your", accent: "closet", blurb: "Everything you own, by category.", link: { href: "/closet", label: "Open Closet" }, cover: { kind: "nav", tab: "Closet" }, steps: [
    { text: "Tap CLOSET (bottom of the screen on a phone, top on a computer).", cue: { kind: "nav", tab: "Closet" } },
    { text: "Tap a word at the top (TOPS, SHOES…) to see only those.", cue: { kind: "tabs", active: "Tops", others: ["Bottoms", "Shoes"] } },
    { text: "Tap a piece to open it. Tap IN THE WASH? when it's dirty so the app stops suggesting it.", cue: { kind: "button", label: "In the wash?", variant: "secondary" } },
    { text: "Tap your name at the top left to look at someone else's closet, or the whole FAMILY closet.", cue: { kind: "switcher", label: "Jeff" } },
  ] },
  { slug: "today", title: "Get dressed", accent: "today", blurb: "Three looks for the weather and the plan.", link: { href: "/today", label: "Open Today" }, cover: { kind: "board" }, steps: [
    { text: "Tap TODAY. The first time, tap ENTER ZIP so it knows your weather.", cue: { kind: "nav", tab: "Today" } },
    { text: "Tap CHECK-IN (top right) and tap how you look today, or take a selfie. Only you (and a parent, for kids) can see the selfie.", cue: { kind: "link", label: "Check-in" } },
    { text: "Tap EDIT next to the date to say what the plan is (dinner, gym, school…). If your Google Calendar is connected, it already knows.", cue: { kind: "link", label: "Sun 18 Oct · Edit" } },
    { text: "Swipe sideways to see the three looks.", cue: { kind: "swipe" } },
    { text: "Tap WEAR THIS when you've picked. Tap CHANGE A PIECE to change one thing. Tap MORE LOOKS for three new ones.", cue: { kind: "button", label: "Wear this" } },
  ] },
  { slug: "together", title: "Dress", accent: "together", blurb: "One look each, made to go together.", link: { href: "/today/together", label: "Open Together" }, cover: { kind: "strip", label: "Going out together?" }, steps: [
    { text: "On Today, tap GOING OUT TOGETHER?", cue: { kind: "strip", label: "Going out together? →" } },
    { text: "Tap the people coming. Tap COORDINATE (same mood), MATCH (same colors), or CONTRAST (different on purpose).", cue: { kind: "tabs", active: "Coordinate", others: ["Match", "Contrast"] } },
    { text: "Tap DRESS US. Everyone gets a look. Each person taps their own WEAR THIS (parents can tap for kids).", cue: { kind: "button", label: "Dress us" } },
  ] },
  { slug: "fits", title: "Your", accent: "fits", blurb: "Every day you got dressed, on a calendar.", link: { href: "/fits", label: "Open Fits" }, cover: { kind: "calendar" }, steps: [
    { text: "Tap FITS. Every day you tapped WEAR THIS shows up on the calendar.", cue: { kind: "nav", tab: "Fits" } },
    { text: "Tap a day to see what you wore. Tap ADD PHOTO to add a picture from that night.", cue: { kind: "button", label: "Add photo", variant: "secondary" } },
    { text: "Tap SHARE to pick who can see it. The line under the photo always says who can.", cue: { kind: "link", label: "Share" } },
    { text: "Forgot to tap WEAR THIS? Tap that day, tap SAVE THE FIT, and pick the pieces.", cue: { kind: "button", label: "Save the fit" } },
  ] },
  { slug: "shop", title: "Should I", accent: "buy it?", blurb: "A verdict before you pay.", link: { href: "/shop", label: "Open Shop" }, cover: { kind: "verdict", word: "BUY IT" }, steps: [
    { text: "Tap SHOP.", cue: { kind: "nav", tab: "Shop" } },
    { text: "Tap PASTE A LINK and paste the store link, or tap SCREENSHOT, or tap TAKE A PHOTO in the dressing room.", cue: { kind: "button", label: "Paste a link" } },
    { text: "Read the verdict: BUY IT, MAYBE, or SKIP IT, with one reason.", cue: { kind: "verdict", word: "MAYBE" } },
    { text: "Look at WEAR IT WITH to see three ways to wear it with clothes you already own.", cue: { kind: "board" } },
    { text: "Shopping for someone else? Tap SHOPPING FOR at the top. You can shop for your kids, or anyone who allowed it in their Settings.", cue: { kind: "switcher", label: "Shopping for Mya" } },
  ] },
  { slug: "profile", title: "Your", accent: "profile", blurb: "Sizes, style, stores, and who sees what.", link: { href: "/profile", label: "Open Profile" }, cover: { kind: "switcher", label: "Jeff" }, steps: [
    { text: "Tap your name at the top left, then PROFILE.", cue: { kind: "switcher", label: "Jeff" } },
    { text: "BODY: your sizes and measurements. Only you can see them, plus parents for kids, plus anyone you choose in Settings.", cue: { kind: "row", label: "Body", value: "Private" } },
    { text: "Body photos: when you add one, pick ONLY ME to keep it to yourself. The app can still use it to dress you.", cue: { kind: "tabs", active: "Only me", others: ["Parents", "Family"] } },
    { text: "STYLE: colors you love, colors you avoid, words that describe you. The looks follow this.", cue: { kind: "row", label: "Style", value: "Loves navy" } },
    { text: "BRANDS & STORES: your favorites. Shopping picks lean on these.", cue: { kind: "row", label: "Stores", value: "Vuori" } },
    { text: "SETTINGS: your zip, who can see your body profile, who can shop for you, Google Calendar.", cue: { kind: "icon", name: "calendar" } },
  ] },
  { slug: "clean-out", title: "Clean", accent: "out", blurb: "Keep, donate, or sell what you don't wear.", link: { href: "/closet/clean-out", label: "Open Clean-out" }, cover: { kind: "strip", label: "Time for a clean-out?" }, steps: [
    { text: "When Today shows TIME FOR A CLEAN-OUT?, tap it.", cue: { kind: "strip", label: "Time for a clean-out? →" } },
    { text: "Each piece hasn't been worn in a while. Tap KEEP to hide it for 3 months, DONATE or SELL to retire it. Changed your mind? Tap UNDO in the strip that appears.", cue: { kind: "tabs", active: "Keep", others: ["Donate", "Sell"] } },
    { text: "Retired pieces keep their history. Open one from the closet and tap BRING IT BACK if you change your mind.", cue: { kind: "button", label: "Bring it back", variant: "secondary" } },
  ] },
  { slug: "admins", title: "For", accent: "admins", blurb: "People, lists, and rules.", adminOnly: true, link: { href: "/admin/people", label: "Open Admin" }, cover: { kind: "icon", name: "mail" }, steps: [
    { text: "Tap your name, then PEOPLE to invite family (email or text), set roles, and link kids to parents.", cue: { kind: "icon", name: "mail" } },
    { text: "LISTS: every word the app uses (categories, colors, occasions, check-in answers…) lives here. You can also tap EDIT wherever a list shows up.", cue: { kind: "tabs", active: "Tops", others: ["Shoes", "Edit"] } },
    { text: "RULES: how many days before a piece can repeat, how many months before clean-out, and the household time zone.", cue: { kind: "row", label: "No repeat", value: "14 days" } },
    { text: "A kid's body photos need a parent's OK on their People page. Turning it off deletes the photos.", cue: { kind: "row", label: "Body photos", value: "Allowed" } },
  ] },
];

export function findTopic(slug: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.slug === slug);
}
