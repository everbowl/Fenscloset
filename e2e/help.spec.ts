import { expect, test } from "./fixtures";
import { ADMIN_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe("help", () => {
  test.beforeAll(() => { resetAndSeed({ adminReady: true }); });

  test("topics grid opens a topic with a picture per step, admin topic only for admins", async ({ page }) => {
    await loginAs(page, "avery@example.test", ADMIN_PASSWORD);
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
    await page.goto("/help/add");
    await expect(page.getByTestId("help-topic")).toContainText("Before you start: One piece per photo");
    await expect(page.getByTestId("help-topic")).toContainText("Shoes: Both shoes side by side");
  });

  test("unknown topic is a 404", async ({ page }) => {
    await loginAs(page, "avery@example.test", ADMIN_PASSWORD);
    const res = await page.goto("/help/nope");
    expect(res?.status()).toBe(404);
  });
});
