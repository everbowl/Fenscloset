import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_DB, JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  resetAndSeed({ jeffReady: true });
  const env = { ...process.env, DATABASE_URL: E2E_DB, MOCK_S3: "true" };
  execSync("npx tsx e2e/seed-closets.ts Jeff Brittney Olivia Mya", { stdio: "ignore", env });
  execSync(`npx tsx e2e/set-password.ts brittney@example.com ${JEFF_PASSWORD}`, { stdio: "ignore", env });
});

test("morning flow: Jeff gets three looks, checks in, sets the plan, swaps, wears; the fit lands on the calendar; clean-out", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/today");
  await expect(page.getByTestId("today")).toBeVisible();
  // weather needs a zip the first time
  await page.getByTestId("enter-zip").click();
  await page.getByRole("dialog").getByRole("textbox").fill("92101");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("weather-block")).toContainText("68°");
  await expect(page.getByTestId("weather-block")).toContainText("61° tonight");
  await expect(page.getByTestId("weather-date")).toHaveText(/\w{3} \d{1,2} \w{3}/);
  await expect(page.getByText("Weather by Open-Meteo")).toBeVisible();
  await expect(page.getByTestId("board")).toHaveCount(3);
  await expect(page.getByTestId("piece-list")).toContainText("TOPS");
  await expect(page.getByTestId("reason")).toBeVisible();

  // check-in by taps
  await page.getByTestId("check-in").click();
  await page.getByRole("radio", { name: "Medium" }).click();
  await page.getByRole("radio", { name: "Great" }).click();
  await page.getByTestId("save-check-in").click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByTestId("refreshing")).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId("why")).toContainText("Weather");

  // plan from the editable occasion list
  await page.getByTestId("edit-plan").click();
  await page.getByTestId("plan-Dinner out").click();
  await expect(page.getByTestId("context-line")).toContainText("DINNER OUT");
  await expect(page.getByTestId("refreshing")).toBeHidden({ timeout: 20_000 });

  // swap one piece on the first look
  await page.getByTestId("swap").click();
  const firstPiece = page.getByRole("dialog").locator("[data-testid^=swap-]").first();
  await firstPiece.click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByTestId("reason")).toContainText("Mock swap");

  // take a piece off the look: no empty boxes, the board reshapes to what is left
  const piecesBefore = (await page.getByTestId("piece-list").first().innerText()).split("·").length;
  await page.getByTestId("swap").click();
  await page.getByRole("dialog").locator("[data-testid^=remove-]").first().click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByTestId("reason")).toContainText("Mock: without");
  expect((await page.getByTestId("piece-list").first().innerText()).split("·").length).toBe(piecesBefore - 1);
  await expect(page.getByTestId("board").first()).toHaveAttribute("data-pieces", String(piecesBefore - 1));

  // more looks → 6
  await page.getByTestId("more-looks").click();
  await expect(page.getByTestId("board")).toHaveCount(6);
  await expect(page.getByText("04 / 06")).toBeVisible();

  // wear it
  await page.getByTestId("wear-this").click();
  await expect(page.getByRole("link", { name: /Wearing this/ })).toBeVisible();
  await page.getByRole("link", { name: /Wearing this/ }).click();
  await expect(page).toHaveURL(/\/fits/);
  await expect(page.getByTestId("fit-panel")).toBeVisible();
  await expect(page.getByTestId("visibility")).toContainText("Visible to Jeff only");
  await expect(page.getByTestId("day-with-fit")).toHaveCount(1);

  // how did it go? three taps on the fit panel; the chosen one goes solid
  await page.getByTestId("rate-loved").click();
  await expect(page.getByTestId("rate-loved")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("rating-row")).toContainText("It went");

  // taste memory section exists on the Style page (one wear is not enough for a learned line yet)
  await page.goto("/profile/style");
  await expect(page.getByTestId("taste-memory")).toBeVisible();
  await expect(page.getByTestId("taste-memory")).toContainText(/Nothing yet|Reaches for|Passed on|Loved wearing/);
  await page.goto("/fits");

  // share with Brittney
  await page.getByTestId("share").click();
  await page.getByRole("dialog").getByRole("option", { name: "Brittney" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("visibility")).toContainText("Visible to Jeff, Brittney only");

  // clean-out strip on Today → keep the old parka
  await page.goto("/today");
  await page.getByTestId("clean-out-link").click();
  await expect(page.getByTestId("clean-out-row")).toHaveCount(1);
  await page.locator("[data-testid^=keep-]").click();
  await expect(page.getByTestId("clean-out-undo")).toContainText("Kept");
  await expect(page.getByTestId("clean-out-row")).toHaveCount(0);
});

test("Brittney sees Jeff's shared fit in the family calendar and gets her own looks; together mode for three", async ({ page }) => {
  await loginAs(page, "brittney@example.com", JEFF_PASSWORD);
  await page.goto("/today");
  await expect(page.getByTestId("board")).toHaveCount(3);
  await page.getByTestId("wear-this").click();
  await expect(page.getByRole("link", { name: /Wearing this/ })).toBeVisible();

  await page.getByRole("button", { name: /Brittney menu/ }).click();
  await page.getByRole("option", { name: "Family" }).click();
  await expect(page.getByRole("button", { name: /Family menu/ })).toBeVisible();
  await page.goto("/fits");
  await expect(page.getByTestId("fit-panel")).toHaveCount(2); // Jeff's (shared) + hers
  await expect(page.getByTestId("fit-panel").first()).toContainText("JEFF");

  // together: Brittney + Jeff + Olivia (Mya is not offered to a non-parent… Brittney is Mya's parent, so she is offered)
  await page.goto("/today/together");
  await page.getByTestId("together-person-Jeff").click();
  await page.getByTestId("together-person-Olivia").click();
  await page.getByTestId("mode-match").click();
  await page.getByTestId("dress-us").click();
  await expect(page.getByTestId("together-boards")).toBeVisible();
  await expect(page.locator("[data-testid^=together-board-]")).toHaveCount(3);
  await expect(page.getByTestId("together-board-Olivia")).toContainText("Mock match look for Olivia");
  await expect(page.getByTestId("wear-Brittney")).toBeVisible();
  await expect(page.getByTestId("wear-Olivia")).toHaveCount(0); // only Olivia (or her parent) wears for Olivia
});
