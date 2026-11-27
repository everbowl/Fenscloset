import { expect, test } from "./fixtures";
import { ADMIN_PASSWORD, loginAs, resetAndSeed } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => resetAndSeed({ adminReady: true }));

test("Avery fills his body profile and settings; parents edit Devon's; Casey is invited, gets her closet, and cannot see body data until granted", async ({ page, browser }) => {
  await loginAs(page, "avery@example.test", ADMIN_PASSWORD);

  // own body profile from the editable measurement list
  await page.goto("/profile");
  await page.getByTestId("row-body").click();
  await expect(page).toHaveURL(/\/profile\/body$/);
  await expect(page.getByText("Visible to Avery")).toBeVisible();
  await page.getByTestId("measure-waist").click();
  await page.getByTestId("measure-sheet").getByRole("option", { name: "32" }).click();
  await expect(page.getByTestId("measure-waist")).toContainText("32 in");
  // sizes by brand are read here and edited on the Brands page (P1)
  await expect(page.getByTestId("body-sizes")).toContainText("No sizes yet");
  await page.getByTestId("edit-sizes").click();
  await expect(page).toHaveURL(/\/profile\/brands$/);

  // settings: zip + privacy rows exist for an adult
  await page.goto("/profile/settings");
  await page.getByTestId("row-zip").click();
  await page.getByRole("dialog").getByRole("textbox").fill("92101");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("row-zip")).toContainText("92101");
  await expect(page.getByTestId("row-body-viewers")).toContainText("Only me");

  // parent views and edits Devon's body profile
  await page.getByRole("button", { name: /Avery menu/ }).click();
  await page.getByRole("button", { name: "Devon" }).click();
  await expect(page.getByRole("button", { name: /Devon menu/ })).toBeVisible();
  await page.goto("/profile/body");
  await expect(page.getByText("Visible to Devon, Avery, Blake only")).toBeVisible();
  await expect(page.getByText("Approved by Avery")).toBeVisible();
  await page.getByTestId("measure-height").click();
  await page.getByTestId("measure-sheet").getByRole("option", { name: `5'4"` }).click();
  await expect(page.getByTestId("measure-height")).toContainText(`5'4"`);
  await page.getByRole("button", { name: /Devon menu/ }).click();
  await page.getByRole("button", { name: "Avery" }).click();
  await expect(page.getByRole("button", { name: /Avery menu/ })).toBeVisible();

  // invite Casey (seeded, no password yet) end-to-end
  await page.goto("/admin/people");
  await page.getByRole("link", { name: /Casey/ }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "Email" }).fill("casey@example.com");
  await sheet.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByTestId("invite-url")).toBeVisible({ timeout: 20_000 }); // the link always comes, even when no email could be sent
  const url = (await page.getByTestId("invite-url").textContent())!.trim();

  const ctx = await browser.newContext();
  const casey = await ctx.newPage();
  await casey.goto(url);
  await casey.getByLabel("Choose a password").fill("casey-rules-21");
  await casey.getByRole("button", { name: "Open my closet" }).click();
  await expect(casey).toHaveURL(/\/today$/);
  await casey.goto("/closet");
  await expect(casey.getByRole("heading", { name: "Closet" })).toBeVisible();
  await expect(casey.getByText("0 pieces")).toBeVisible();
  await casey.goto("/profile");
  await expect(casey.getByTestId("row-body")).toContainText("Not filled in");

  // Devon's body data is invisible to Casey
  await casey.getByRole("button", { name: /Casey menu/ }).click();
  await casey.getByRole("button", { name: "Devon" }).click();
  await expect(casey.getByRole("button", { name: /Devon menu/ })).toBeVisible();
  await casey.goto("/profile");
  await expect(casey.getByTestId("row-body")).toContainText("Private");
  await casey.goto("/profile/body");
  await expect(casey.getByText("Devon's body profile is private")).toBeVisible();
  await expect(casey.getByText("64 in")).toHaveCount(0);

  // Avery's too, until he grants it
  await casey.getByRole("button", { name: /Devon menu/ }).click();
  await casey.getByRole("button", { name: "Avery" }).click();
  await expect(casey.getByRole("button", { name: /Avery menu/ })).toBeVisible();
  await casey.goto("/profile");
  await expect(casey.getByTestId("row-body")).toContainText("Private");

  await page.goto("/profile/settings");
  await page.getByTestId("row-body-viewers").click();
  await page.getByRole("dialog").getByRole("button", { name: "Casey" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("row-body-viewers")).toContainText("Casey");

  await casey.goto("/profile/body");
  await expect(casey.getByTestId("measure-waist")).toContainText("32 in");
  await ctx.close();
});

test("inspiration board: add a look, see what it read, remove it", async ({ page }) => {
  await loginAs(page, "avery@example.test", ADMIN_PASSWORD);
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

test("my brands & sizes: add Lululemon with a size per item type and a link, then one tap on the confirm card fills brand and the right size", async ({ page }) => {
  await loginAs(page, "avery@example.test", ADMIN_PASSWORD);
  // height + weight → likely sizes, offered as the dashed chip
  await page.goto("/profile/body");
  await page.getByTestId("measure-height").click();
  await page.getByTestId("measure-sheet").getByRole("option", { name: `6'0"` }).click();
  await page.getByTestId("measure-weight").click();
  await page.getByTestId("measure-sheet").getByRole("option", { name: "185" }).click();
  await expect(page.getByTestId("likely-sizes")).toContainText("Tops L");
  await page.goto("/profile/brands");
  await expect(page.getByTestId("my-brands")).toContainText("None yet");
  await page.getByTestId("add-my-brand").click();
  await page.getByRole("dialog").getByRole("button", { name: /^Lululemon/ }).click();
  await expect(page.getByTestId("my-size-tops")).toContainText("Likely L");
  await page.getByTestId("my-size-tops").click();
  await page.getByTestId("size-sheet").getByRole("option", { name: /^L/ }).click();
  await page.getByTestId("my-size-bottoms").click();
  await page.getByTestId("size-sheet").getByRole("option", { name: "32", exact: true }).click();
  await page.getByTestId("my-brand-url").fill("shop.lululemon.com");
  await page.getByTestId("save-my-brand").click();
  await expect(page.getByTestId("my-brands")).toContainText("Lululemon");
  await expect(page.getByTestId("my-brands")).toContainText("Tops L · Bottoms 32 · shop.lululemon.com");

  // a fresh photo → confirm card offers "Lululemon · L" as one tap, and asks for more photos
  const buffer = Buffer.from(await (await import("sharp")).default({ create: { width: 800, height: 1100, channels: 3, background: { r: 20, g: 20, b: 20 } } }).jpeg().toBuffer());
  await page.goto("/add");
  await page.getByTestId("pick-photos").setInputFiles({ name: "tee.jpg", mimeType: "image/jpeg", buffer });
  const confirmLink = page.getByRole("link", { name: /Confirm 1 ready/ });
  await expect(confirmLink).toBeVisible({ timeout: 30_000 });
  await confirmLink.click();
  await expect(page.getByTestId("ask-more-photos")).toContainText("Now the back");
  await page.getByTestId("more-no").click();
  await expect(page.getByTestId("ask-more-photos")).toHaveCount(0);
  await expect(page.getByTestId("my-brand-pills")).toContainText("Lululemon · L");
  await page.getByTestId("my-brand-pills").getByRole("button", { name: "Lululemon · L" }).click();
  await expect(page.getByTestId("row-brand")).toContainText("Lululemon · L");
  await expect(page.getByTestId("my-brand-pills")).toHaveCount(0);
  await page.getByTestId("confirm-next").click();
  // the last card of a batch lands in the closet with "N added · see them"; a batch with leftovers shows All done
  await expect(page.getByTestId("toast-ok").or(page.getByRole("heading", { name: /All done/ }))).toBeVisible({ timeout: 15_000 });

  // the same photo again: "Another one like this?" → Yes copies the details (brand, size, name) onto the new piece
  await page.goto("/add");
  await page.getByTestId("pick-photos").setInputFiles({ name: "tee2.jpg", mimeType: "image/jpeg", buffer });
  await expect(page.getByRole("link", { name: /Confirm 1 ready/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: /Confirm 1 ready/ }).click();
  await expect(page.getByTestId("like-sheet")).toContainText("Another one of these");
  await page.getByTestId("like-mirror").click();
  await expect(page.getByTestId("row-brand")).toContainText("Lululemon · L");
  await expect(page.getByTestId("duplicate-row")).toContainText("Details copied");
  await page.getByTestId("confirm-next").click();
  await expect(page.getByTestId("toast-ok").or(page.getByRole("heading", { name: /All done/ }))).toBeVisible({ timeout: 15_000 });

  // the new piece carries the brand's store link; "Added · another?" strip is on the item after its own photo
  await page.goto("/closet");
  await page.getByTestId("item-card").first().click();
  await expect(page.getByRole("button", { name: /^Brand · Size/ })).toContainText("Lululemon · L");
  await expect(page.getByRole("button", { name: /^Link/ })).toContainText("shop.lululemon.com");
});
