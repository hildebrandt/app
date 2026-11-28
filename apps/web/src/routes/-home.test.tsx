// @vitest-environment jsdom
import { createAgent } from "@ui-sdk/react/agent";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AgentWorkspace } from "./-agent-workspace";

const agent = createAgent();
const exampleName = /^Create a new project/u;

const getComposer = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ask Agent" });

const getExample = () => screen.getByRole("button", { name: exampleName });

const renderHome = () =>
  act(async () => {
    render(createElement(AgentWorkspace));
  });

describe("home route", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("marks only Agent as current and moves focus to the composer", async () => {
    await renderHome();

    const nav = within(screen.getByRole("navigation", { name: "Workspace" }));
    const agentButton = nav.getByRole("button", {
      current: "page",
      name: "Agent",
    });

    for (const label of ["Inbox", "Documents"]) {
      const button = nav.getByRole("button", { name: label, current: false });
      expect(button.getAttribute("aria-disabled")).toBe("true");
    }

    fireEvent.click(agentButton);

    expect(document.activeElement).toBe(getComposer());
  });

  it("dismisses the announcement without losing the draft", async () => {
    await renderHome();

    fireEvent.input(getComposer(), { target: { value: "Keep this draft" } });
    const announcement = screen.getByRole("region", { name: "What's new" });

    fireEvent.click(
      within(announcement).getByRole("button", { name: "Dismiss announcement" })
    );

    expect(screen.queryByRole("region", { name: "What's new" })).toBeNull();
    expect(getComposer().value).toBe("Keep this draft");
    expect(document.activeElement).toBe(getComposer());
  });

  it("sends chat through the transport and reports unavailable chat", async () => {
    const reply = "Here is the launch plan.";
    const stream = [
      { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" },
      {
        type: "TEXT_MESSAGE_START",
        messageId: "assistant-1",
        role: "assistant",
      },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "assistant-1", delta: reply },
      { type: "TEXT_MESSAGE_END", messageId: "assistant-1" },
      { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1" },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("");
    const requests: Array<{ init: RequestInit; url: string }> = [];

    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      requests.push({ init, url: String(input) });

      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    });

    await renderHome();

    const form = screen.getByRole("form", { name: "Start a new chat" });
    const composer = getComposer();
    const submit = screen.getByRole("button", { name: "Submit prompt" });

    fireEvent.input(composer, { target: { value: "   " } });

    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(fireEvent.submit(form)).toBe(false);
    expect(requests).toHaveLength(0);

    fireEvent.input(composer, { target: { value: "  Plan a launch brief  " } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(reply)).toBeTruthy();
      expect(screen.queryByText("Agent is responding")).toBeNull();
    });

    expect(composer.value).toBe("");
    expect(requests).toHaveLength(1);

    const request = requests[0];

    expect(request?.url).toBe("/api/chat");
    expect(request?.init.method).toBe("POST");
    expect(new Headers(request?.init.headers).get("content-type")).toBe(
      "application/json"
    );
    expect(request?.init.credentials).toBe("same-origin");

    const payload = JSON.parse(String(request?.init.body)) as {
      messages: Array<{ content: unknown; role: string }>;
    };
    const userMessage = payload.messages.at(-1);

    expect(userMessage?.role).toBe("user");
    expect(userMessage?.content).toBe("Plan a launch brief");

    let unavailableRequests = 0;

    vi.stubGlobal("fetch", async () => {
      unavailableRequests += 1;

      throw new Error("provider refused");
    });

    fireEvent.input(composer, { target: { value: "Try again" } });
    fireEvent.submit(form);

    const workspace = screen.getByRole("region", { name: "Agent workspace" });
    const alert = await within(workspace).findByRole("alert");

    expect(alert.textContent).toBe("Chat is unavailable. Try again.");
    expect(screen.queryByText(/provider refused/u)).toBeNull();
    expect(unavailableRequests).toBe(1);
  });

  it.each([
    ["Create a new project", "Turn an idea into a well-scoped project"],
    ["Research a topic", "Research a topic across the issue backlog"],
    [
      "Set up new team",
      "Create a team that matches how your organization works",
    ],
  ])("starts an editable draft from %s", async (title, prompt) => {
    await renderHome();

    expect(getComposer().value).toBe("");

    const card = screen.getByRole("button", {
      name: (name) => name.startsWith(title),
    });
    fireEvent.click(within(card).getByText(title));

    await waitFor(() => {
      expect(document.activeElement).toBe(getComposer());
    });

    const composer = getComposer();

    expect(composer.value).toBe(prompt);

    fireEvent.input(composer, { target: { value: "Plan a launch brief" } });

    expect(getComposer().value).toBe("Plan a launch brief");
  });

  it("lets a UI SDK agent edit the prompt by its accessible name", async () => {
    await renderHome();

    const result = await agent.act({
      steps: [
        { ref: "Ask Agent", action: "setValue", args: ["Outline a launch"] },
      ],
    });

    expect(result.ok, result.error?.message).toBe(true);

    expect(getComposer().value).toBe("Outline a launch");
  });

  it("keeps the edited draft when the examples are dismissed", async () => {
    await renderHome();

    fireEvent.click(getExample());
    fireEvent.input(getComposer(), {
      target: { value: "Plan a launch brief" },
    });

    const dismiss = screen.getByRole("button", { name: "Dismiss examples" });
    act(() => {
      dismiss.focus();
    });
    fireEvent.click(dismiss);

    expect(getComposer().value).toBe("Plan a launch brief");
    expect(screen.queryByRole("button", { name: exampleName })).toBeNull();
    expect(document.activeElement).toBe(getComposer());
  });
});
