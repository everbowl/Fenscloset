import { expect, test } from "@playwright/test";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe("help", () => {
  test.beforeAll(() => { resetAndSeed({ jeffReady: true }); });

  test("topics grid opens a topic with a picture per step, admin topic only for admins", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    await page.goto("/help");
    await expect(page.getByTestId("help")).toBeVisible();
    await expect(page.getByTestId("help-topic-admins")).toBeVisible();
    await page.getByTestId("help-topic-today").click();
    await expect(page.getByTestId("help-topic")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Get dressed/ })).toBeVisible();
    await expect(page.getByText("Swipe sideways to see the three looks.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Today" })).toHaveAttribute("href", "/today");
    await page.getByRole("link", { name: /Next: Dress together/ }).click();
    await expect(page).toHaveURL(/\/help\/together$/);
  });

  test("unknown topic is a 404", async ({ page }) => {
    await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
    const res = await page.goto("/help/nope");
    expect(res?.status()).toBe(404);
  });
});
