/** Default lists. Every one of these is editable in the app; this is only the starting point. */

export const PEOPLE = [
  { key: "jeff", name: "Jeff", email: "jeff@everbowl.com", role: "admin" as const },
  { key: "brittney", name: "Brittney", email: null, role: "admin" as const, age: 43 },
  { key: "olivia", name: "Olivia", email: null, role: "member" as const, age: 21 },
  { key: "mya", name: "Mya", email: null, role: "minor" as const, age: 15, guardians: ["jeff", "brittney"] },
];

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

export const CHECK_IN_SCALES: Record<string, string[]> = {
  Tan: ["None", "Light", "Medium", "Deep"],
  Hair: ["Great", "Fine", "Bad hair day"],
  Skin: ["Clear", "Okay", "Breakout"],
};

export const RULES = [
  { key: "noRepeatDays", value: "14", label: "No-repeat window (days)", description: "Don't suggest an outfit piece that was worn within this many days." },
  { key: "notWornMonths", value: "6", label: "Not-worn alert (months)", description: "Flag items that haven't been worn in this many months for a closet clean-out." },
];

export const DEV_PASSWORD = "0535";
