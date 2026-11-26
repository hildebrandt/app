import { expect, test } from "@playwright/test";

const exampleName = /^Create a new project/u;
const examplePrompt = "Turn an idea into a well-scoped project";

test("renders the agent workspace and keeps submit reachable by keyboard", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("navigation", { name: "Workspace" })
  ).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Ask Agent" });

  await expect(composer).toBeVisible();

  const submit = page.getByRole("button", { name: "Submit prompt" });

  await composer.focus();
  await page.keyboard.press("Tab");

  await expect(submit).toBeFocused();
  await expect(submit).toHaveAttribute("aria-disabled", "true");
});

test("starts a draft from an example and keeps it after dismissal", async ({
  page,
}) => {
  await page.goto("/");

  const composer = page.getByRole("textbox", { name: "Ask Agent" });

  await expect(composer).toHaveValue("");

  await page.getByRole("button", { name: exampleName }).click();

  await expect(composer).toHaveValue(examplePrompt);
  await expect(composer).toBeFocused();

  await composer.fill("Plan a launch brief");

  await page.getByRole("button", { name: "Dismiss examples" }).click();

  await expect(page.getByRole("button", { name: exampleName })).toHaveCount(0);
  await expect(composer).toHaveValue("Plan a launch brief");
});
