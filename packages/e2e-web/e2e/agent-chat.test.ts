import { expect, type Locator, type Page } from "@playwright/test";

import {
  chatChunk,
  finishedTurn,
  test,
  textMessageSteps,
  type ChatPair,
  type Scenario,
} from "./fixtures/chat-pair.js";

const composer = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Ask Agent" });
const submitButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Submit prompt" });
const stopButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Stop", exact: true });
const retryButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Retry", exact: true });
const status = (page: Page): Locator =>
  page.locator('footer span[role="status"]');
const alert = (page: Page): Locator => page.locator('p[role="alert"]');
const userMessages = (page: Page): Locator =>
  page.locator('ol[aria-label="Chat messages"] li[data-role="user"]');
const assistantMessages = (page: Page): Locator =>
  page.locator('ol[aria-label="Chat messages"] li[data-role="assistant"]');

async function openChat(page: Page, pair: ChatPair): Promise<void> {
  await page.goto(pair.webUrl);
  await expect(composer(page)).toBeEditable();
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  await composer(page).fill(prompt);
  const submit = submitButton(page);
  await expect(submit).not.toHaveAttribute("aria-disabled", "true");
  await submit.click();
}

async function runs(pair: ChatPair) {
  return (await pair.control.state()).runs;
}

test.describe("agent chat transport outcomes", () => {
  test("keyboard Stop aborts the backend turn and keeps partial text and draft", async ({
    page,
    chatPair,
  }) => {
    const threadId = "thread-stop";
    const partial = "Partial answer retained.";
    const late = "LATE TEXT MUST NOT APPEAR";
    const followUp = "Follow-up answer after stop.";

    const scenarios: Scenario[] = [
      {
        steps: [
          { type: "chunk", chunk: chatChunk.runStarted(threadId, "run-stop") },
          ...textMessageSteps("assistant-stop", partial),
          { type: "hold" },
          ...textMessageSteps("assistant-late", late),
          { type: "chunk", chunk: chatChunk.runFinished(threadId, "run-stop") },
          { type: "end" },
        ],
      },
      {
        steps: finishedTurn(threadId, "run-follow-up", "assistant-follow-up", followUp),
      },
    ];

    await chatPair.control.reset(scenarios);
    await openChat(page, chatPair);

    await sendPrompt(page, "First prompt");
    await expect(page.getByText(partial, { exact: true })).toBeVisible();
    await expect(stopButton(page)).toBeVisible();
    await expect(status(page)).toHaveText("Agent is responding");

    await expect
      .poll(async () => (await runs(chatPair))[0]?.holding)
      .toBe(true);

    const draft = "Draft kept after stop";
    await composer(page).fill(draft);
    await stopButton(page).focus();
    await page.keyboard.press("Enter");

    await expect(stopButton(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("Response stopped");
    await expect(alert(page)).toHaveCount(0);
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.getByText(partial, { exact: true })).toBeVisible();
    await expect(composer(page)).toHaveValue(draft);

    await expect
      .poll(async () => (await runs(chatPair))[0]?.aborted)
      .toBe(true);

    await chatPair.control.release(0);
    await expect
      .poll(async () => (await runs(chatPair))[0]?.lateAttempted)
      .toBe(true);

    await expect(page.getByText(late, { exact: false })).toHaveCount(0);
    await expect(status(page)).toHaveText("Response stopped");
    await expect(alert(page)).toHaveCount(0);

    await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await sendPrompt(page, "Second prompt");
    await expect(page.getByText(followUp, { exact: true })).toBeVisible();
    await expect(status(page)).toHaveText("");

    const stateRuns = await runs(chatPair);
    expect(stateRuns).toHaveLength(2);
    expect(stateRuns[0]?.messages.map((message) => message.content)).toEqual([
      "First prompt",
    ]);
    expect(stateRuns[1]?.messages.map((message) => message.content)).toEqual([
      "First prompt",
      partial,
      "Second prompt",
    ]);
    await expect(userMessages(page)).toHaveCount(2);
    await expect(userMessages(page).nth(0)).toContainText("First prompt");
    await expect(userMessages(page).nth(1)).toContainText("Second prompt");
  });

  test("clean EOF keeps partial text and Retry replaces the answer once", async ({
    page,
    chatPair,
  }) => {
    const threadId = "thread-interrupted";
    const partial = "Partial answer before the connection ended.";
    const recovered = "Recovered answer after retry.";
    const newerDraft = "A newer draft must survive retry";

    const scenarios: Scenario[] = [
      {
        steps: [
          { type: "chunk", chunk: chatChunk.runStarted(threadId, "run-interrupted") },
          ...textMessageSteps("assistant-interrupted", partial),
          { type: "end" },
        ],
      },
      {
        steps: finishedTurn(threadId, "run-recovered", "assistant-recovered", recovered),
      },
    ];

    await chatPair.control.reset(scenarios);
    await openChat(page, chatPair);

    await sendPrompt(page, "Interrupted prompt");
    await expect(page.getByText(partial, { exact: true })).toBeVisible();
    await expect(alert(page)).toHaveText("Response interrupted. Try again.");
    await expect(retryButton(page)).toBeVisible();
    await expect(stopButton(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("");
    await expect(userMessages(page)).toHaveCount(1);

    await composer(page).fill(newerDraft);
    await retryButton(page).click();

    await expect(alert(page)).toHaveCount(0);
    await expect(page.getByText(recovered, { exact: true })).toBeVisible();
    await expect(page.getByText(partial, { exact: false })).toHaveCount(0);
    await expect(status(page)).toHaveText("");
    await expect(retryButton(page)).toHaveCount(0);
    await expect(userMessages(page)).toHaveCount(1);
    await expect(assistantMessages(page)).toHaveCount(1);
    await expect(assistantMessages(page).first()).toContainText(recovered);
    await expect(composer(page)).toHaveValue(newerDraft);

    const stateRuns = await runs(chatPair);
    expect(stateRuns).toHaveLength(2);
    expect(stateRuns[0]?.terminal).toBe("eof");
    const retryUsers = stateRuns[1]?.messages.filter(
      (message) => message.role === "user",
    );
    expect(retryUsers).toEqual([
      { role: "user", content: "Interrupted prompt" },
    ]);
    expect(
      stateRuns[1]?.messages.map((message) => message.content),
    ).not.toContain(partial);
  });

  test("explicit RUN_ERROR shows the sanitized unavailable copy and Retry", async ({
    page,
    chatPair,
  }) => {
    const threadId = "thread-error";
    const partial = "Partial answer before the provider failed.";
    const leaked = "provider secret detail";

    const scenarios: Scenario[] = [
      {
        steps: [
          { type: "chunk", chunk: chatChunk.runStarted(threadId, "run-error") },
          ...textMessageSteps("assistant-error", partial),
          {
            type: "chunk",
            chunk: chatChunk.runError(threadId, "run-error", leaked),
          },
        ],
      },
    ];

    await chatPair.control.reset(scenarios);
    await openChat(page, chatPair);

    await sendPrompt(page, "Error prompt");
    await expect(alert(page)).toHaveText("Chat is unavailable. Try again.");
    await expect(page.getByText(leaked, { exact: false })).toHaveCount(0);
    await expect(page.getByText(partial, { exact: true })).toBeVisible();
    await expect(retryButton(page)).toBeVisible();
    await expect(stopButton(page)).toHaveCount(0);
    await expect(status(page)).toHaveText("");
    await expect(userMessages(page)).toHaveCount(1);

    await expect
      .poll(async () => (await runs(chatPair))[0]?.ended)
      .toBe(true);
    const stateRuns = await runs(chatPair);
    expect(stateRuns).toHaveLength(1);
    expect(stateRuns[0]?.terminal).toBe("error");
  });

  test("normal RUN_FINISHED leaves no error, stopped copy, or Retry", async ({
    page,
    chatPair,
  }) => {
    const threadId = "thread-normal";
    const answer = "Normal completed answer.";

    await chatPair.control.reset([
      {
        steps: finishedTurn(threadId, "run-normal", "assistant-normal", answer),
      },
    ]);
    await openChat(page, chatPair);

    await sendPrompt(page, "Normal prompt");
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await expect(status(page)).toHaveText("");
    await expect(alert(page)).toHaveCount(0);
    await expect(retryButton(page)).toHaveCount(0);
    await expect(stopButton(page)).toHaveCount(0);
    await expect(userMessages(page)).toHaveCount(1);
    await expect(assistantMessages(page)).toHaveCount(1);

    await expect
      .poll(async () => (await runs(chatPair))[0]?.ended)
      .toBe(true);

    const stateRuns = await runs(chatPair);
    expect(stateRuns).toHaveLength(1);
    expect(stateRuns[0]?.terminal).toBe("finished");
    expect(stateRuns[0]?.aborted).toBe(false);
    expect(stateRuns[0]?.messages).toEqual([
      { role: "user", content: "Normal prompt" },
    ]);
  });

  test("two same-tick submissions send one request and do not drain later", async ({
    page,
    chatPair,
  }) => {
    const threadId = "thread-race";
    const held = "Held first answer.";
    const probe = "Probe answer.";

    await chatPair.control.reset([
      {
        steps: [
          { type: "chunk", chunk: chatChunk.runStarted(threadId, "run-held") },
          { type: "hold" },
          ...textMessageSteps("assistant-held", held),
          { type: "chunk", chunk: chatChunk.runFinished(threadId, "run-held") },
        ],
      },
      {
        steps: finishedTurn(threadId, "run-probe", "assistant-probe", probe),
      },
      {
        steps: finishedTurn(threadId, "run-extra", "assistant-extra", "Unexpected extra answer."),
      },
    ]);
    await openChat(page, chatPair);

    await composer(page).fill("Race prompt");
    await expect(submitButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await page
      .locator('form[aria-label="Start a new chat"]')
      .evaluate((element) => {
        if (!(element instanceof HTMLFormElement)) {
          throw new Error("composer is not a form");
        }
        element.requestSubmit();
        element.requestSubmit();
      });

    await expect
      .poll(async () => (await runs(chatPair))[0]?.holding)
      .toBe(true);
    expect(await runs(chatPair)).toHaveLength(1);
    await expect(userMessages(page)).toHaveCount(1);
    await expect(userMessages(page).first()).toContainText("Race prompt");

    await chatPair.control.release(0);
    await expect(page.getByText(held, { exact: true })).toBeVisible();
    await expect(status(page)).toHaveText("");

    await sendPrompt(page, "Probe prompt");
    await expect(page.getByText(probe, { exact: true })).toBeVisible();
    await expect(status(page)).toHaveText("");

    const stateRuns = await runs(chatPair);
    expect(stateRuns).toHaveLength(2);
    expect(
      stateRuns.map((run) =>
        run.messages
          .filter((message) => message.role === "user")
          .map((message) => message.content),
      ),
    ).toEqual([
      ["Race prompt"],
      ["Race prompt", "Probe prompt"],
    ]);
    await expect(userMessages(page)).toHaveCount(2);
    await expect(userMessages(page).nth(0)).toContainText("Race prompt");
    await expect(userMessages(page).nth(1)).toContainText("Probe prompt");
    await expect(assistantMessages(page)).toHaveCount(2);
  });
});
