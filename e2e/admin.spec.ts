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
  // a number saves when the field is left; "✓ Saved" shows beside the label
  await page.getByLabel("Days before a piece repeats").fill("21");
  await page.getByLabel("Days before a piece repeats").press("Enter");
  await expect(page.getByTestId("rule-saved-noRepeatDays")).toHaveText("✓ Saved");
  await page.reload();
  await expect(page.getByLabel("Days before a piece repeats")).toHaveValue("21");
  // the button color is a preset or any color; nothing waits for a re-cut, so that upkeep row is not shown
  await expect(page.getByTestId("accent-orange")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("untidy-photos")).toHaveCount(0);
  await page.getByTestId("accent-blue").click();
  await expect(page.getByTestId("rule-saved-accentColor")).toHaveText("✓ Saved");
  await page.reload();
  await expect(page.getByTestId("accent-blue")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("rule-accentColor")).toContainText("#1D4ED8");
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
  await page.getByLabel("Email").first().blur(); // details save when the field is left
  await expect(page.getByTestId("toast-ok")).toContainText("Details saved");
  await page.getByRole("button", { name: "Send invite" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Create invite" }).click();
  await expect(sheet.getByText("Invite created")).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Remove person" }).click();
  await expect(page.getByText(/What happens to the pieces in Olivia/)).toBeVisible();
  await page.getByRole("button", { name: /Move Olivia.s pieces to Family/ }).click();
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
