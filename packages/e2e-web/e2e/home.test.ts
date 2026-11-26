import { expect, test } from "@playwright/test";

test("renders the web home page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("img", { name: "Turborepo logo" }).first()
  ).toBeVisible();

  await expect(
    page.getByText("Get started by editing apps/web/src/routes/index.tsx")
  ).toBeVisible();
});
