import { expect, test } from "@playwright/test";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";
import { execSync } from "node:child_process";

/** Shop v2 item 5 (Jeff, 28 Oct 2026: "C", filters and sorts): the Sort and Filter pills under the category tabs, all of it in the URL. */
test.describe("closet views", () => {
  test.beforeAll(() => {
    resetAndSeed({ jeffReady: true });
    execSync("npx tsx e2e/seed-views.ts", { stdio: "inherit", env: { ...process.env, DATABASE_URL: "postgresql://postgres@localhost:5433/fenscloset_e2e", MOCK_S3: "true" } });
  });

  test("sort, filter with live counts, chips, the tabs and the search keep the view, the empty state clears it", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/closet");
    await expect(page.getByText("5 pieces")).toBeVisible();
    const cards = page.getByTestId("item-card");
    await expect(cards).toHaveCount(5);
    await expect(cards.first()).toContainText("White linen shirt"); // newest first
    await expect(page.getByTestId("sort-button")).toHaveText("Sort · Newest first");
    await expect(page.getByTestId("filter-button")).toHaveText("Filter");

    // sort: the sheet, the pick, the URL
    await page.getByTestId("sort-button").click();
    await expect(page.getByTestId("sort-sheet")).toBeVisible();
    await expect(page.getByRole("option", { name: "Newest first" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("option", { name: "Worn the most" }).click();
    await expect(page).toHaveURL(/sort=most-worn/);
    await expect(cards.first()).toContainText("Dark jeans");
    await expect(page.getByTestId("sort-button")).toHaveText("Sort · Worn the most");

    // filter: a tap applies at once, the grid and the counts follow
    await page.getByTestId("filter-button").click();
    const sheet = page.getByTestId("filter-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("filter-count")).toHaveText("5 of 5 pieces");
    await expect(sheet.getByRole("button", { name: /^Black 3$/ })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^In the wash 1$/ })).toBeVisible();
    await sheet.getByRole("button", { name: /^Black 3$/ }).click();
    await expect(sheet.getByTestId("filter-count")).toHaveText("3 of 5 pieces");
    await expect(cards).toHaveCount(3);
    await expect(sheet.getByRole("button", { name: /^White 1$/ })).toBeVisible(); // a picked color never hides its siblings
    await expect(sheet.getByRole("button", { name: /^Nike 2$/ })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^Levi's/ })).toHaveCount(0); // nothing black is Levi's
    await sheet.getByRole("button", { name: /^Favorites 1$/ }).click();
    await expect(sheet.getByTestId("filter-count")).toHaveText("1 of 5 pieces");
    await page.getByTestId("filter-done").click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("1 of 5 pieces")).toBeVisible();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Black crew tee");
    await expect(page.getByTestId("filter-button")).toHaveText("Filter · 2");
    await expect(page.getByTestId("filter-chip")).toHaveText(["Black ×", "Favorites ×"]);
    await expect(page).toHaveURL(/color=/);
    await expect(page).toHaveURL(/fav=1/);

    // a chip's × drops that one filter; the sort stays
    await page.getByTestId("filter-chip").filter({ hasText: "Favorites" }).click();
    await expect(cards).toHaveCount(3);
    await expect(page).not.toHaveURL(/fav=1/);
    await expect(page).toHaveURL(/sort=most-worn/);
    await expect(cards.first()).toContainText("Black crew tee"); // the most worn of the black ones

    // a category tab keeps the sort and the filters
    await page.getByRole("link", { name: "Bottoms", exact: true }).click();
    await expect(page).toHaveURL(/cat=/);
    await expect(page).toHaveURL(/sort=most-worn/);
    await expect(page).toHaveURL(/color=/);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Running shorts");
    await expect(page.getByText("1 of 5 pieces")).toBeVisible();

    // the laundry facet, after clearing from inside the sheet
    await page.getByTestId("filter-button").click();
    await sheet.getByTestId("filter-sheet-clear").click();
    await expect(sheet.getByTestId("filter-count")).toHaveText("2 of 5 pieces");
    await sheet.getByRole("button", { name: /^At the cleaners 1$/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Running shorts");
    await page.getByTestId("filter-done").click();
    await expect(page.getByTestId("filter-chip")).toHaveText(["At the cleaners ×"]);

    // the search keeps the filters and the sort
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("searchbox", { name: "Search" }).fill("nike");
    await page.getByRole("searchbox", { name: "Search" }).press("Enter");
    await expect(page).toHaveURL(/q=nike/);
    await expect(page).toHaveURL(/status=cleaners/);
    await expect(cards).toHaveCount(1);

    // nothing left: the empty state names the filters and clears them, keeping the tab and the sort
    await page.goto("/closet?sort=most-worn");
    await page.getByTestId("filter-button").click();
    await sheet.getByRole("button", { name: /^Favorites 1$/ }).click();
    await page.getByTestId("filter-done").click();
    await page.getByRole("link", { name: "Bottoms", exact: true }).click();
    await expect(page.getByTestId("closet-empty")).toHaveText("Nothing matches these filters");
    await expect(page.getByText("0 of 5 pieces")).toBeVisible();
    await page.getByTestId("empty-clear-filters").click();
    await expect(cards).toHaveCount(2);
    await expect(page).toHaveURL(/cat=/);
    await expect(page).toHaveURL(/sort=most-worn/);
    await expect(page).not.toHaveURL(/fav=/);

    // the other sorts
    for (const [sort, first] of [["forgotten", "White linen shirt"], ["price-high", "White linen shirt"], ["price-low", "Black crew tee"], ["recent", "Dark jeans"], ["name", "Black crew tee"], ["oldest", "Dark jeans"]] as const) {
      await page.goto(`/closet?sort=${sort}`);
      await expect(cards.first()).toContainText(first);
    }
    await page.goto("/closet?sort=nonsense");
    await expect(page.getByTestId("sort-button")).toHaveText("Sort · Newest first");
  });
});
