import { expect, test } from "@playwright/test";
import { JEFF_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => resetAndSeed({ jeffReady: true }));

test("Jeff fills his body profile and settings; parents edit Mya's; Olivia is invited, gets her closet, and cannot see body data until granted", async ({ page, browser }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);

  // own body profile from the editable measurement list
  await page.goto("/profile");
  await page.getByTestId("row-body").click();
  await expect(page).toHaveURL(/\/profile\/body$/);
  await expect(page.getByText("Visible to Jeff")).toBeVisible();
  await page.getByTestId("measure-waist").click();
  await page.getByRole("dialog").getByRole("textbox").fill("32");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("measure-waist")).toContainText("32 in");
  await page.getByTestId("add-size").click();
  await page.getByRole("dialog").getByLabel("Size").fill("L");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^L$|L · /).first()).toBeVisible();

  // settings: zip + privacy rows exist for an adult
  await page.goto("/profile/settings");
  await page.getByTestId("row-zip").click();
  await page.getByRole("dialog").getByRole("textbox").fill("92101");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("row-zip")).toContainText("92101");
  await expect(page.getByTestId("row-body-viewers")).toContainText("Only me");

  // parent views and edits Mya's body profile
  await page.getByRole("button", { name: /Jeff menu/ }).click();
  await page.getByRole("option", { name: "Mya" }).click();
  await expect(page.getByRole("button", { name: /Mya menu/ })).toBeVisible();
  await page.goto("/profile/body");
  await expect(page.getByText("Visible to Mya, Jeff, Brittney only")).toBeVisible();
  await expect(page.getByText("Approved by Jeff")).toBeVisible();
  await page.getByTestId("measure-height").click();
  await page.getByRole("dialog").getByRole("textbox").fill("64");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("measure-height")).toContainText("64 in");
  await page.getByRole("button", { name: /Mya menu/ }).click();
  await page.getByRole("option", { name: "Jeff" }).click();
  await expect(page.getByRole("button", { name: /Jeff menu/ })).toBeVisible();

  // invite Olivia (seeded, no password yet) end-to-end
  await page.goto("/admin/people");
  await page.getByRole("link", { name: /Olivia/ }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "Email" }).fill("olivia@example.com");
  await sheet.getByRole("button", { name: "Create invite" }).click();
  const url = (await page.getByTestId("invite-url").textContent())!.trim();

  const ctx = await browser.newContext();
  const olivia = await ctx.newPage();
  await olivia.goto(url);
  await olivia.getByLabel("Choose a password").fill("olivia-rules-21");
  await olivia.getByLabel("Type it again").fill("olivia-rules-21");
  await olivia.getByRole("button", { name: "Open my closet" }).click();
  await expect(olivia).toHaveURL(/\/today$/);
  await olivia.goto("/closet");
  await expect(olivia.getByRole("heading", { name: "Closet" })).toBeVisible();
  await expect(olivia.getByText("0 pieces")).toBeVisible();
  await olivia.goto("/profile");
  await expect(olivia.getByTestId("row-body")).toContainText("Not filled in");

  // Mya's body data is invisible to Olivia
  await olivia.getByRole("button", { name: /Olivia menu/ }).click();
  await olivia.getByRole("option", { name: "Mya" }).click();
  await expect(olivia.getByRole("button", { name: /Mya menu/ })).toBeVisible();
  await olivia.goto("/profile");
  await expect(olivia.getByTestId("row-body")).toContainText("Private");
  await olivia.goto("/profile/body");
  await expect(olivia.getByText("Mya's body profile is private")).toBeVisible();
  await expect(olivia.getByText("64 in")).toHaveCount(0);

  // Jeff's too, until he grants it
  await olivia.getByRole("button", { name: /Mya menu/ }).click();
  await olivia.getByRole("option", { name: "Jeff" }).click();
  await expect(olivia.getByRole("button", { name: /Jeff menu/ })).toBeVisible();
  await olivia.goto("/profile");
  await expect(olivia.getByTestId("row-body")).toContainText("Private");

  await page.goto("/profile/settings");
  await page.getByTestId("row-body-viewers").click();
  await page.getByRole("dialog").getByRole("option", { name: "Olivia" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("row-body-viewers")).toContainText("Olivia");

  await olivia.goto("/profile/body");
  await expect(olivia.getByTestId("measure-waist")).toContainText("32 in");
  await ctx.close();
});

test("inspiration board: add a look, see what it read, remove it", async ({ page }) => {
  await loginAs(page, "jeff@everbowl.com", JEFF_PASSWORD);
  await page.goto("/profile/style");
  await expect(page.getByTestId("inspiration")).toBeVisible();
  const buffer = Buffer.from(await (await import("sharp")).default({ create: { width: 240, height: 320, channels: 3, background: { r: 190, g: 170, b: 130 } } }).jpeg().toBuffer());
  await page.getByTestId("inspiration-file").setInputFiles({ name: "look.jpg", mimeType: "image/jpeg", buffer });
  await expect(page.getByTestId("inspiration-tile")).toHaveCount(1);
  await expect(page.getByTestId("inspiration")).toContainText("1 saved");
  await page.getByTestId("inspiration-tile").first().click();
  await expect(page.getByTestId("inspiration-sheet")).toContainText("camel + black");
  await page.getByTestId("remove-inspiration").click();
  await expect(page.getByTestId("inspiration-tile")).toHaveCount(0);
});
