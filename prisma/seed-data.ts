/** Default lists. Every one of these is editable in the app; this is only the starting point. */

export const PEOPLE = [
  { key: "jeff", name: "Jeff", email: "jeff@everbowl.com", role: "admin" as const },
  { key: "brittney", name: "Brittney", email: null, role: "admin" as const, age: 43 },
  { key: "olivia", name: "Olivia", email: null, role: "member" as const, age: 21 },
  { key: "mya", name: "Mya", email: null, role: "minor" as const, age: 15, guardians: ["jeff", "brittney"] },
];

/** Default photo tips per category. Seeded only where a category has none, so admin edits stick. */
export const PHOTO_TIPS: Record<string, string> = {
  Tops: "Lay flat, buttoned or zipped, sleeves out to the sides. Front side up.",
  Bottoms: "Lay flat, waistband at the top, legs straight. Fold nothing.",
  Dresses: "Hang on a plain wall or lay flat full length. Straps and hem both in the frame.",
  Outerwear: "Zip or button it, collar flat, sleeves out. Hang or lay flat, front side up.",
  Shoes: "Both shoes side by side, toes toward you, on a plain floor. No box.",
  Purses: "Stand it up, straps tucked behind, front facing you.",
  Hats: "Front view, brim flat on the table, logo facing you.",
  Belts: "Coil it loosely with the buckle on top and facing you.",
  Jewelry: "On a plain white surface, close up, one piece at a time.",
  Sunglasses: "Open, front view, lenses toward you, on a plain surface.",
  Activewear: "Lay flat like a top or bottom. Shoot sports bras front side up.",
  Swimwear: "Lay flat, front side up. Shoot a bikini top and bottom as two photos.",
};

export const CATEGORIES: Record<string, string[]> = {
  Tops: ["T-shirt", "Tank", "Blouse", "Button-down", "Sweater", "Hoodie", "Sweatshirt", "Crop top", "Bodysuit"],
  Bottoms: ["Jeans", "Trousers", "Shorts", "Skirt", "Leggings", "Joggers"],
  Dresses: ["Mini", "Midi", "Maxi", "Sundress", "Cocktail", "Gown"],
  Outerwear: ["Jacket", "Blazer", "Coat", "Denim jacket", "Leather jacket", "Puffer", "Cardigan", "Vest"],
  Shoes: ["Sneakers", "Sandals", "Boots", "Heels", "Flats", "Loafers", "Slides"],
  Purses: ["Tote", "Crossbody", "Shoulder bag", "Clutch", "Backpack", "Mini bag"],
  Hats: ["Baseball cap", "Beanie", "Bucket hat", "Sun hat", "Fedora"],
  Belts: ["Leather belt", "Chain belt", "Fabric belt"],
  Jewelry: ["Necklace", "Earrings", "Bracelet", "Ring", "Watch"],
  Sunglasses: ["Aviator", "Round", "Cat-eye", "Square", "Sport"],
  Activewear: ["Sports bra", "Workout top", "Workout shorts", "Workout leggings"],
  Swimwear: ["One-piece", "Bikini top", "Bikini bottom", "Cover-up"],
  Sleepwear: ["Pajamas", "Robe"],
  Accessories: ["Scarf", "Gloves", "Hair accessory", "Socks", "Tights"],
};

export const COLORS: { name: string; hex: string }[] = [
  { name: "Black", hex: "#111111" }, { name: "White", hex: "#FFFFFF" }, { name: "Cream", hex: "#F5F0E1" },
  { name: "Gray", hex: "#8A8A8A" }, { name: "Charcoal", hex: "#3A3A3A" }, { name: "Navy", hex: "#1F2A44" },
  { name: "Blue", hex: "#2F6FDE" }, { name: "Light blue", hex: "#9CC4F2" }, { name: "Teal", hex: "#1F8A8A" },
  { name: "Green", hex: "#2E7D32" }, { name: "Olive", hex: "#6B7A2E" }, { name: "Sage", hex: "#A3B18A" },
  { name: "Yellow", hex: "#F2C94C" }, { name: "Mustard", hex: "#D4A017" }, { name: "Orange", hex: "#E8762B" },
  { name: "Rust", hex: "#A0522D" }, { name: "Red", hex: "#C62828" }, { name: "Burgundy", hex: "#6D1A2B" },
  { name: "Pink", hex: "#E89AC7" }, { name: "Hot pink", hex: "#E0218A" }, { name: "Purple", hex: "#6A3FA0" },
  { name: "Lavender", hex: "#B9A7E0" }, { name: "Brown", hex: "#6B4226" }, { name: "Tan", hex: "#C9A66B" },
  { name: "Beige", hex: "#D8C3A5" }, { name: "Camel", hex: "#C19A6B" }, { name: "Gold", hex: "#C9A227" },
  { name: "Silver", hex: "#B8B8B8" }, { name: "Multi", hex: "#888888" },
];

export const PATTERNS = ["Solid", "Stripe", "Plaid", "Floral", "Polka dot", "Animal print", "Graphic", "Geometric", "Tie-dye", "Color block", "Paisley", "Houndstooth"];
export const FABRICS = ["Cotton", "Denim", "Linen", "Silk", "Satin", "Wool", "Cashmere", "Knit", "Jersey", "Leather", "Suede", "Polyester", "Nylon", "Spandex", "Velvet", "Lace", "Chiffon", "Fleece", "Corduroy", "Tweed"];
export const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
export const FORMALITY = ["Lounge", "Casual", "Smart casual", "Business", "Cocktail", "Formal"];
export const OCCASIONS = ["Everyday", "Work", "School", "Gym", "Date night", "Dinner out", "Party", "Wedding", "Beach", "Travel", "Church", "Brunch", "Concert", "Outdoor", "Errands"];
export const TAGS = ["Favorite", "Comfy", "Statement", "Basics", "Needs repair", "Too small", "Too big", "Loaner", "Vintage", "Gift"];
export const BRANDS = ["Lululemon", "Nike", "Adidas", "Levi's", "Zara", "H&M", "Aritzia", "Free People", "Madewell", "J.Crew", "Abercrombie & Fitch", "Gap", "Old Navy", "Target", "Amazon", "Uniqlo", "Reformation", "Skims", "Alo", "Vuori", "Brandy Melville", "Urban Outfitters", "Anthropologie", "Nordstrom", "Steve Madden", "Birkenstock", "Converse", "New Balance", "Coach", "Kate Spade"];
export const STORES = ["Nordstrom", "Target", "Amazon", "Zara", "Aritzia", "Lululemon", "Urban Outfitters", "Free People", "Madewell", "Abercrombie & Fitch", "Revolve", "Shein", "ASOS", "Nike", "Sephora"];

/** Sizes offered per category (Jeff, 18 Oct 2026: size by item type). Editable under Admin → Lists → Sizes. */
export const SIZE_OPTIONS: Record<string, string[]> = {
  Tops: ["XS", "S", "M", "L", "XL", "XXL", "Youth S", "Youth M", "Youth L", "Youth XL"],
  Outerwear: ["XS", "S", "M", "L", "XL", "XXL", "Youth S", "Youth M", "Youth L", "Youth XL"],
  Activewear: ["XS", "S", "M", "L", "XL", "XXL", "Youth S", "Youth M", "Youth L", "Youth XL"],
  Swimwear: ["XS", "S", "M", "L", "XL", "XXL", "Youth S", "Youth M", "Youth L", "Youth XL"],
  Dresses: ["XS", "S", "M", "L", "XL", "XXL", "0", "2", "4", "6", "8", "10", "12", "14", "16", "Youth S", "Youth M", "Youth L", "Youth XL"],
  Bottoms: ["XS", "S", "M", "L", "XL", "XXL", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "Youth 4", "Youth 5", "Youth 6", "Youth 7", "Youth 8", "Youth 10", "Youth 12", "Youth 14", "Youth 16"],
  // Shoes carry men's and women's US sizes side by side (Jeff, 19 Oct 2026): one option covers both.
  Shoes: ["M 4 / W 5.5", "M 4.5 / W 6", "M 5 / W 6.5", "M 5.5 / W 7", "M 6 / W 7.5", "M 6.5 / W 8", "M 7 / W 8.5", "M 7.5 / W 9", "M 8 / W 9.5", "M 8.5 / W 10", "M 9 / W 10.5", "M 9.5 / W 11", "M 10 / W 11.5", "M 10.5 / W 12", "M 11 / W 12.5", "M 11.5 / W 13", "M 12 / W 13.5", "M 12.5 / W 14", "M 13 / W 14.5", "M 13.5 / W 15", "M 14 / W 15.5", "M 14.5 / W 16", "M 15 / W 16.5", "Youth 1", "Youth 2", "Youth 3", "Youth 4", "Youth 5", "Youth 6"],
  Hats: ["S/M", "L/XL", "One size", "Youth"],
  Belts: ["S", "M", "L", "XL", "28", "30", "32", "34", "36", "38", "40", "42", "44"],
};
/** Body measurements in the order they are asked (Jeff, 19 Oct 2026: basics preloaded, categorized and ordered). Each has preloaded options (src/lib/profiles/size-options.ts). */
export const MEASUREMENT_KINDS: { name: string; unit: string }[] = [
  { name: "Height", unit: "in" }, { name: "Weight", unit: "lb" },
  { name: "Chest / bust", unit: "in" }, { name: "Cup size", unit: "" }, { name: "Waist", unit: "in" }, { name: "Hips", unit: "in" },
  { name: "Inseam", unit: "in" }, { name: "Shoulders", unit: "in" }, { name: "Sleeve", unit: "in" }, { name: "Neck", unit: "in" },
  { name: "Shoe size", unit: "US" }, { name: "Hat size", unit: "" },
];
export const STYLE_WORDS = ["Minimal", "Classic", "Streetwear", "Preppy", "Boho", "Edgy", "Sporty", "Romantic", "Vintage", "Glam", "Comfy", "Polished"];
/** Body photos approved for a minor by a parent admin (spec: Mya, approved by Jeff). */
export const BODY_IMAGE_APPROVALS: { minor: string; by: string }[] = [{ minor: "mya", by: "jeff" }];

export const CHECK_IN_SCALES: Record<string, string[]> = {
  Tan: ["None", "Light", "Medium", "Deep"],
  Hair: ["Great", "Fine", "Bad hair day"],
  Skin: ["Clear", "Okay", "Breakout"],
};

export const RULES = [
  { key: "noRepeatDays", value: "14", label: "No-repeat window (days)", description: "Don't suggest an outfit piece that was worn within this many days." },
  { key: "notWornMonths", value: "6", label: "Not-worn alert (months)", description: "Flag items that haven't been worn in this many months for a closet clean-out." },
  { key: "timezone", value: "America/Los_Angeles", label: "Household time zone", description: "Decides when 'today' starts for check-ins, looks and the Fits calendar." },
  { key: "accentColor", value: "#FF5A00", label: "Button color (hex)", description: "The color of the main buttons. Everything else stays black and white. Jeff, 19 Oct 2026: real orange." },
  // Likely sizes from height and weight (adults only; a starting point, shown on the Body page and offered when recording a size in a brand).
  { key: "sizeBandXsMaxLb", value: "125", label: "Likely size · XS up to (lb)", description: "Weight at or under this reads as XS for tops, outerwear and dresses." },
  { key: "sizeBandSMaxLb", value: "150", label: "Likely size · S up to (lb)", description: "Weight at or under this reads as S." },
  { key: "sizeBandMMaxLb", value: "180", label: "Likely size · M up to (lb)", description: "Weight at or under this reads as M." },
  { key: "sizeBandLMaxLb", value: "210", label: "Likely size · L up to (lb)", description: "Weight at or under this reads as L." },
  { key: "sizeBandXlMaxLb", value: "240", label: "Likely size · XL up to (lb)", description: "Weight at or under this reads as XL; above it, XXL." },
  { key: "sizeTallIn", value: "74", label: "Likely size · tall from (in)", description: "Height at or above this bumps the letter size up one." },
  { key: "sizeShortIn", value: "64", label: "Likely size · short up to (in)", description: "Height at or under this bumps the letter size down one." },
  { key: "waistDivisorX10", value: "55", label: "Likely waist · divisor ×10", description: "Likely waist ≈ weight ÷ (this ÷ 10), nudged by height. 55 means weight ÷ 5.5: 170 lb → about 31." },
];

export const DEV_PASSWORD = "0535";

/**
 * The mirror's styling lists (Jeff, 19 Oct 2026: "don't default to tucking it in; give me options on pose
 * and how the clothes will show"). Editable under Admin → Lists; the first entry of each list is the
 * default. A prompt is what the artist is told to change; blank means nothing needs changing.
 */
export const MIRROR_POSES: { name: string; prompt: string }[] = [
  { name: "Standing, as photographed", prompt: "" },
  { name: "Hands in pockets", prompt: "both hands resting in the front pockets of the bottoms, shoulders relaxed" },
  { name: "One hand in a pocket", prompt: "one hand in a front pocket, the other arm relaxed at the side" },
  { name: "Arms crossed", prompt: "arms crossed loosely over the chest" },
  { name: "Walking", prompt: "caught mid-stride, walking toward the camera with a natural relaxed gait" },
  { name: "Turned to the side", prompt: "the body turned three-quarters away from the camera, the head turned back to look at the camera" },
  { name: "Looking back", prompt: "turned to face away from the camera, looking back over one shoulder" },
];

/** `needs`: every listed item feature must be in the look for the group to be offered (space-separated); blank = always. */
export const WEAR_GROUPS: { name: string; needs: string; options: { name: string; prompt: string }[] }[] = [
  { name: "Tuck", needs: "top bottom", options: [
    { name: "Untucked", prompt: "the top is worn untucked, its hem hanging loose over the waistband" },
    { name: "Tucked", prompt: "the top is tucked fully into the waistband all the way around" },
    { name: "Front tuck", prompt: "only the front of the top is tucked into the waistband; the sides and back hang loose" },
    { name: "Half tuck", prompt: "one side of the front of the top is tucked in at the waistband; the rest hangs loose" },
  ] },
  { name: "Buttons", needs: "button_front", options: [
    { name: "Top one open", prompt: "the top button of the shirt is undone, the rest buttoned" },
    { name: "All buttoned", prompt: "the shirt buttoned all the way up to the collar" },
    { name: "Top two open", prompt: "the top two buttons of the shirt undone" },
    { name: "Top three open", prompt: "the top three buttons of the shirt undone" },
    { name: "Open", prompt: "the shirt worn fully unbuttoned and open at the front" },
  ] },
  { name: "Sleeves", needs: "long_sleeve", options: [
    { name: "Down", prompt: "" },
    { name: "Cuffed once", prompt: "the sleeves cuffed once at the wrist" },
    { name: "Rolled to the elbow", prompt: "the sleeves rolled neatly up to the elbow" },
    { name: "Pushed up", prompt: "the sleeves pushed casually up the forearms" },
  ] },
  { name: "Outer layer", needs: "outer", options: [
    { name: "Open", prompt: "the outer layer worn open at the front" },
    { name: "Closed", prompt: "the outer layer fully zipped or buttoned closed" },
    { name: "Half closed", prompt: "the outer layer zipped or buttoned halfway up" },
  ] },
  { name: "Hood", needs: "hood", options: [
    { name: "Down", prompt: "the hood down, resting on the back" },
    { name: "Up", prompt: "the hood up over the head" },
  ] },
  { name: "Collar", needs: "collar", options: [
    { name: "Down", prompt: "" },
    { name: "Popped", prompt: "the collar popped up" },
  ] },
  { name: "Hem", needs: "bottom", options: [
    { name: "As is", prompt: "" },
    { name: "Cuffed once", prompt: "the pant legs cuffed once at the ankle" },
    { name: "Rolled", prompt: "the pant legs rolled up twice above the ankle" },
  ] },
];
