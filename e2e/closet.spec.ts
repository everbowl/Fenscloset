import { expect, test } from "@playwright/test";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";
import { execSync } from "node:child_process";

test.describe("closet", () => {
  test.beforeAll(() => {
    resetAndSeed({ jeffReady: true });
    execSync("npx tsx e2e/seed-items.ts", { stdio: "inherit", env: { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", MOCK_S3: "true" } });
  });

  test("grid, category tabs, search, item detail with one-tap laundry, person switcher and Family closet", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/closet");
    await expect(page.getByRole("heading", { name: "Closet" })).toBeVisible();
    await expect(page.getByText("2 pieces")).toBeVisible();
    await expect(page.getByTestId("item-card")).toHaveCount(2);
    await expect(page.getByTestId("item-card").first()).toContainText("New");

    // tabs come from the list; EDIT is there for admins
    await page.getByRole("link", { name: "Bottoms", exact: true }).click();
    await expect(page.getByTestId("item-card")).toHaveCount(1);
    await expect(page.getByTestId("item-card")).toContainText("Dark jeans");
    await expect(page.getByRole("button", { name: "Edit categories" })).toBeVisible();

    // search by brand
    await page.goto("/closet");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("searchbox", { name: "Search" }).fill("levi");
    await page.getByRole("searchbox", { name: "Search" }).press("Enter");
    await expect(page.getByTestId("item-card")).toHaveCount(1);

    // item detail: laundry word changes with one tap and shows in the grid
    await page.getByTestId("item-card").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Dark jeans");
    await page.getByTestId("laundry-cycle").click();
    await expect(page.getByText("Laundry · Laundry")).toBeVisible();
    await page.goto("/closet");
    await expect(page.getByTestId("item-card").filter({ hasText: "Dark jeans" })).toContainText("Laundry");

    // put it in the Family closet, then switch the header to FAMILY and see it there
    await page.getByTestId("item-card").filter({ hasText: "Dark jeans" }).click();
    await page.getByTestId("row-closets").click();
    await page.getByRole("dialog").getByRole("option", { name: /Family/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("row-closets")).toContainText("Family");
    await page.getByRole("button", { name: /Jeff menu/ }).click();
    await page.getByRole("option", { name: "Family closet" }).click();
    await expect(page.getByRole("button", { name: /Family menu/ })).toBeVisible(); // the cookie lands before we navigate
    await page.goto("/closet");
    await expect(page.getByRole("heading", { name: /Family closet/ })).toBeVisible();
    await expect(page.getByTestId("item-card")).toHaveCount(1);
    await expect(page.getByTestId("item-card")).toContainText("Jeff");

    // browse Olivia's closet (Q13 A), then come back
    await page.getByRole("button", { name: /Family menu/ }).click();
    await page.getByRole("option", { name: "Olivia" }).click();
    await expect(page.getByRole("button", { name: /Olivia menu/ })).toBeVisible();
    await page.goto("/closet");
    await expect(page.getByRole("heading", { name: /Olivia/ })).toBeVisible();
    await expect(page.getByText("0 pieces")).toBeVisible();
  });

  test("mirror from the closet: tap Mirror, pick pieces, see them on a mannequin (no body photo yet); a piece's page has See it on", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/closet");
    await page.getByTestId("closet-mirror").click();
    await expect(page.getByTestId("pick-bar")).toContainText("Tap the pieces");
    await page.getByTestId("item-card").filter({ hasText: "White crew tee" }).click();
    await page.getByTestId("item-card").filter({ hasText: "Dark jeans" }).click();
    await expect(page.getByTestId("pick-bar")).toContainText("2 picked");
    await page.getByTestId("see-picked").click();
    // the mirror may first ask to complete the look (shoes…); e2e/mirror-complete.spec.ts covers the asking
    while (await page.getByTestId("complete-skip").isVisible()) await page.getByTestId("complete-skip").click();
    await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("dialog")).toContainText("White crew tee · Dark jeans");
    await expect(page.getByTestId("try-on-sheet")).toContainText("No body photo used");
    await expect(page.getByTestId("try-on-sheet").locator("img").first()).toHaveAttribute("src", /\/api\/photo\/mannequin\//);
    await expect(page.getByTestId("retake-body-photo")).toHaveText("Add photo"); // no body photo: the mirror offers it right here
    await page.keyboard.press("Escape");
    await page.getByTestId("pick-cancel").click();
    await page.getByTestId("item-card").filter({ hasText: "White crew tee" }).click();
    await page.getByTestId("see-on-me").click();
    while (await page.getByTestId("complete-skip").isVisible()) await page.getByTestId("complete-skip").click();
    await expect(page.getByTestId("try-on-sheet")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("dialog")).toContainText("White crew tee");
  });
});
