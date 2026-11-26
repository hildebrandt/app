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
import { afterEach, describe, expect, it } from "vite-plus/test";

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
  afterEach(cleanup);

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

  it("prevents native submission while sending is unavailable", async () => {
    await renderHome();

    const form = screen.getByRole("form", { name: "Start a new chat" });
    fireEvent.input(getComposer(), { target: { value: "Do not send" } });

    expect(fireEvent.submit(form)).toBe(false);
    expect(getComposer().value).toBe("Do not send");
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
