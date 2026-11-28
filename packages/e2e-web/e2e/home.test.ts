import { expect, test, type Page } from "@playwright/test";

const exampleName = /^Create a new project/u;
const examplePrompt = "Turn an idea into a well-scoped project";
const editedDraft = "Plan a launch brief";

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

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

test("keeps an edited example draft through footer theme toggles and dismissal on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  const composer = page.getByRole("textbox", { name: "Ask Agent" });
  const footer = page.locator("footer");
  const themeToggle = footer.getByRole("button", {
    name: /^Switch to (?:light|dark) mode$/u,
  });
  const switchTo = (mode: "light" | "dark") =>
    footer.getByRole("button", { name: `Switch to ${mode} mode`, exact: true });

  await expect(composer).toHaveValue("");
  await expect(switchTo("light")).toBeVisible();

  await page.getByRole("button", { name: exampleName }).click();

  await expect(composer).toHaveValue(examplePrompt);
  await expect(composer).toBeFocused();

  await composer.fill(editedDraft);

  // The OS theme is the default until someone uses the footer control.
  const darkBackground = await bodyBackground(page);

  await page.emulateMedia({ colorScheme: "light" });

  const lightBackground = await bodyBackground(page);

  expect(lightBackground).not.toBe(darkBackground);
  await expect(switchTo("dark")).toBeVisible();
  await expect(composer).toHaveValue(editedDraft);
  await expect(composer).toBeFocused();

  await page.emulateMedia({ colorScheme: "dark" });

  await expect(switchTo("light")).toBeVisible();
  await expect.poll(() => bodyBackground(page)).toBe(darkBackground);
  await expect(composer).toHaveValue(editedDraft);
  await expect(composer).toBeFocused();

  await switchTo("light").click();

  await expect(switchTo("dark")).toBeVisible();
  await expect.poll(() => bodyBackground(page)).toBe(lightBackground);
  await expect(composer).toHaveValue(editedDraft);
  await expect(themeToggle).toBeFocused();

  // A chosen theme stays put when the OS theme changes.
  await page.emulateMedia({ colorScheme: "dark" });

  await expect(switchTo("dark")).toBeVisible();
  await expect.poll(() => bodyBackground(page)).toBe(lightBackground);

  await page.emulateMedia({ colorScheme: "light" });

  await expect.poll(() => bodyBackground(page)).toBe(lightBackground);
  await expect(themeToggle).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(switchTo("light")).toBeVisible();
  await expect.poll(() => bodyBackground(page)).toBe(darkBackground);
  await expect(composer).toHaveValue(editedDraft);
  await expect(themeToggle).toBeFocused();

  await page.getByRole("button", { name: "Dismiss examples" }).click();

  await expect(page.getByRole("button", { name: exampleName })).toHaveCount(0);
  await expect(composer).toHaveValue(editedDraft);
  await expect(composer).toBeFocused();

  await page.keyboard.press("Tab");

  const submit = page.getByRole("button", { name: "Submit prompt" });

  await expect(submit).toBeFocused();
  expect(
    await submit.evaluate((button) => button.matches(":focus-visible"))
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBe(390);
});
