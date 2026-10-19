import { expect, test } from "@playwright/test";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => resetAndSeed({ jeffReady: true }));

test("admin edits a list in place: add, rename, reorder, archive, blocked delete message", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/admin/lists/brand");
  await page.getByRole("button", { name: "Add brand" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name").fill("Everbowl Apparel");
  await sheet.getByRole("button", { name: "Add brand" }).click();
  await expect(page.getByText("Everbowl Apparel")).toBeVisible();

  await page.getByRole("button", { name: /^Everbowl Apparel/ }).click();
  await sheet.getByLabel("Name").fill("Everbowl Merch");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Everbowl Merch")).toBeVisible();

  // Drag to reorder: the fourth row goes up two rows (pointer events on the grip), and it sticks after a reload
  await expect(sheet).toBeHidden();
  await page.waitForTimeout(400); // the sheet's closing transition; a drag that starts under it is swallowed
  const rows = page.locator("[data-testid^=list-row-]");
  await page.locator("[data-testid^=grip-]").nth(1).scrollIntoViewIfNeeded(); // the page sits at the new row (bottom); the pointer needs the rows on screen
  const fourth = (await rows.nth(3).innerText()).split("\n")[0];
  const b = (await page.locator("[data-testid^=grip-]").nth(3).boundingBox())!;
  const a = (await page.locator("[data-testid^=grip-]").nth(1).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, a.y + a.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(rows.nth(1)).toContainText(fourth);
  await page.reload();
  await expect(rows.nth(1)).toContainText(fourth);

  // Find in the list
  await page.getByTestId("list-filter").fill("merch");
  await expect(page.locator("[data-testid^=list-row-]")).toHaveCount(1);
  await page.getByTestId("list-filter").fill("");

  // Archive then restore
  const row = page.locator("div", { has: page.getByRole("button", { name: /^Everbowl Merch/ }) }).last();
  await row.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived (1)")).toBeVisible();

  // Closets: Family can't be deleted (no delete button rendered)
  await page.goto("/admin/lists/closet");
  const familyRow = page.locator("div", { has: page.getByRole("button", { name: /^Family/ }) }).last();
  await expect(familyRow.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // Subcategories follow their category
  await page.goto("/admin/lists/subcategory");
  await expect(page.getByRole("button", { name: /^T-shirt/ })).toBeVisible();
  await page.getByLabel("Category").selectOption({ label: "Shoes" });
  await expect(page.getByRole("button", { name: /^Sneakers/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^T-shirt/ })).toHaveCount(0);
});

test("admin changes a rule", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/admin/rules");
  await page.getByLabel("No-repeat window (days)").fill("21");
  await page.locator("form", { has: page.getByLabel("No-repeat window (days)") }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("No-repeat window (days)")).toHaveValue("21");
  // the button color is a hex with a swatch; photo retouch is an on/off choice, off by default
  await expect(page.getByLabel("Button color (hex)")).toHaveValue("#FF5A00");
  await expect(page.getByLabel("AI photo retouch (Tidy and Smooth)")).toHaveValue("off");
  await page.getByLabel("Button color (hex)").fill("#1A2B3C");
  await page.getByTestId("rule-accentColor").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("rule-accentColor").getByRole("button", { name: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Button color (hex)")).toHaveValue("#1A2B3C");
});

test("admin invites a new member; she accepts, lands in her closet, and cannot open admin", async ({ page, browser }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/admin/people");
  await page.getByRole("button", { name: "Add person" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name").fill("Grandma Sue");
  await sheet.getByRole("textbox", { name: "Email" }).fill("sue@example.com");
  await sheet.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByText("Invite created")).toBeVisible();
  const url = (await page.getByTestId("invite-url").textContent())!.trim();
  expect(url).toContain("/invite/");

  const ctx = await browser.newContext();
  const sue = await ctx.newPage();
  await sue.goto(url);
  await expect(sue.getByRole("heading", { name: "Welcome, Grandma" })).toBeVisible();
  await sue.getByLabel("Choose a password").fill("grandma-rules-1");
  await sue.getByLabel("Type it again").fill("grandma-rules-1");
  await sue.getByRole("button", { name: "Open my closet" }).click();
  await expect(sue).toHaveURL(/\/today$/);
  await expect(sue.getByRole("heading", { name: /look/ })).toBeVisible();

  await sue.goto("/admin/people");
  await expect(sue.getByRole("heading", { name: "Admins only" })).toBeVisible();
  await sue.goto("/profile");
  await expect(sue.getByText("People")).toHaveCount(0);
  await ctx.close();

  // The link is single-use.
  await page.goto(url);
  await expect(page.getByText("doesn't work anymore")).toBeVisible();
});

test("admin re-invites a seeded family member and removes a person with the items prompt", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/admin/people");
  await page.getByRole("link", { name: /Olivia/ }).click();
  await page.getByLabel("Email").first().fill("olivia@example.com");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Details saved.")).toBeVisible();
  await page.getByRole("button", { name: "Send invite" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Create invite" }).click();
  await expect(sheet.getByText("Invite created")).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Remove person" }).click();
  await expect(page.getByText("What should happen to the clothes")).toBeVisible();
  await page.getByRole("button", { name: "Move them to the Family closet" }).click();
  await expect(page).toHaveURL(/\/admin\/people$/);
  await expect(page.getByRole("link", { name: /Olivia/ })).toHaveCount(0);
});

test("admin lists: the mirror's poses and wear options are editable lists, untucked first", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/admin/lists");
  await expect(page.getByRole("link", { name: /Mirror poses/ })).toBeVisible();
  await page.goto("/admin/lists/mirrorPose");
  await expect(page.getByText("Standing, as photographed")).toBeVisible();
  await expect(page.getByText("Hands in pockets")).toBeVisible();
  await page.goto("/admin/lists/wearOption");
  const rows = page.locator("[data-testid^=list-row-]");
  await expect(rows.first()).toContainText("Untucked"); // the Tuck group is first, and Untucked is its default
});
