import type { Locator, Page } from "@playwright/test";

import {
	expect,
	test,
	type DraftChatPair,
} from "./fixtures/draft-chat-pair.js";

/**
 * Phase 4 release probes for the draft-editing continuation.
 *
 * Run (after `pnpm --filter web build`):
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:1 \
 *     pnpm --filter @repo/e2e-web e2e e2e/agent-draft-chat.test.ts
 *
 * PLAYWRIGHT_BASE_URL only suppresses playwright.config's default webServer:
 * every test starts its own loopback web/backend pair on ephemeral ports and
 * navigates to that pair's URL. Nothing is reused from a running service.
 */

const prompt = "Please change the draft.";

function footerStatus(page: Page) {
	return page.locator("footer span[role='status']");
}

function draftOutcome(page: Page) {
	return page.locator("p[role='status']");
}

function workspaceAlert(page: Page) {
	return page.getByRole("region", { name: "Agent workspace" }).getByRole("alert");
}

type GateWindow = Window & {
	__draftContinuationBlocked?: boolean;
	__draftContinuationOutcome?: "aborted" | "forwarded" | null;
	__draftContinuationRelease?: () => void;
	__draftHoldContinuation?: boolean;
};

/**
 * Hold the next continuation POST before it reaches the network. This freezes
 * the client after the approved mutation and immediately before result
 * submission, so Stop can be observed without sending a continuation request.
 */
async function installContinuationGate(page: Page) {
	await page.addInitScript(() => {
		const scope = window as GateWindow;
		const originalFetch = window.fetch.bind(window);
		window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url;
			let continuation = false;
			if (
				url.includes("/api/chat") &&
				init?.method?.toUpperCase() === "POST" &&
				typeof init.body === "string"
			) {
				try {
					const body = JSON.parse(init.body) as { resume?: unknown };
					continuation = Array.isArray(body.resume) && body.resume.length > 0;
				} catch {
					continuation = false;
				}
			}
			if (!continuation || scope.__draftHoldContinuation !== true) {
				return originalFetch(input, init);
			}
			scope.__draftContinuationBlocked = true;
			await new Promise<void>((resolve) => {
				scope.__draftContinuationRelease = resolve;
			});
			if (init?.signal?.aborted) {
				scope.__draftContinuationOutcome = "aborted";
				throw new DOMException("The operation was aborted.", "AbortError");
			}
			scope.__draftContinuationOutcome = "forwarded";
			return originalFetch(input, init);
		};
	});
}

async function holdContinuation(page: Page) {
	await page.evaluate(() => {
		const scope = window as GateWindow;
		scope.__draftHoldContinuation = true;
		scope.__draftContinuationOutcome = null;
	});
}

async function waitForBlockedContinuation(page: Page) {
	await page.waitForFunction(
		() => (window as GateWindow).__draftContinuationBlocked === true,
	);
}

async function releaseContinuation(page: Page) {
	await page.evaluate(() => {
		(window as GateWindow).__draftContinuationRelease?.();
	});
}

async function waitForContinuationOutcome(page: Page) {
	await page.waitForFunction(
		() => (window as GateWindow).__draftContinuationOutcome !== null,
	);
}

async function openConnections(page: Page) {
	const trigger = page.getByRole("button", {
		name: "Max Mustermann, agent connections",
	});
	if ((await trigger.getAttribute("data-open")) === null) {
		await trigger.click();
	}
	const grant = page.getByRole("checkbox", {
		name: "Allow agents to edit the draft",
	});
	await expect(grant).toBeEnabled();
	return grant;
}

async function openWorkspace(page: Page, pair: DraftChatPair) {
	await installContinuationGate(page);
	await page.goto(pair.webUrl);
	const grant = await openConnections(page);
	await grant.check();
	return grant;
}

async function submitPrompt(page: Page, value = prompt) {
	const composer = page.locator('form[aria-label="Start a new chat"]');
	await page.getByRole("textbox", { name: "Ask Agent" }).fill(value);
	await composer.getByRole("button", { name: "Submit prompt" }).click();
}

function approvalDialog(page: Page) {
	return page.getByRole("alertdialog", { name: "Approve draft edit?" });
}

async function reachApproval(page: Page, pair: DraftChatPair) {
	await openWorkspace(page, pair);
	await submitPrompt(page);
	await pair.releaseProviderRun(1);
	const dialog = approvalDialog(page);
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(pair.draftValue);
	await expect(dialog).toContainText("(empty)");
	return dialog;
}


async function approve(dialog: Locator) {
	await dialog.getByRole("button", { name: "Approve", exact: true }).click();
	await expect(dialog).toBeHidden();
}


test("approving one proposed draft runs it exactly once and continues automatically", async ({
	page,
	draftChatPair: pair,
}) => {
	const dialog = await reachApproval(page, pair);
	await approve(dialog);

	const second = await pair.waitForProviderRun(2);
	await second.finished;
	await expect(footerStatus(page)).toHaveText("");

	const transcript = page.getByRole("list", { name: "Chat messages" });
	await expect(transcript.locator('li[data-role="user"]')).toHaveCount(1);
	await expect(transcript.locator('li[data-role="assistant"]')).toHaveCount(2);
	await expect(draftOutcome(page)).toHaveText(/^Draft changed\./);

	await expect(page.getByRole("textbox", { name: "Ask Agent" })).toHaveValue(
		pair.draftValue,
	);
	const reopened = await openConnections(page);
	await expect(reopened).toBeChecked();

	expect(pair.posts).toHaveLength(2);
	expect(pair.providerRuns).toHaveLength(2);

	const initial = pair.posts[0];
	const continuation = pair.posts[1];
	if (!(initial && continuation)) {
		throw new Error("Expected exactly two transport requests.");
	}
	expect(initial.continuation).toBe(false);
	expect(initial.owner).toBeTruthy();
	expect(initial.body.runId).toBeTruthy();
	expect(initial.body.resume ?? []).toHaveLength(0);

	const initialMessages = initial.body.messages ?? [];
	expect(initialMessages.filter((message) => message.role === "user")).toHaveLength(1);
	expect(
		initialMessages.some(
			(message) => message.role === "system" || message.role === "developer",
		),
	).toBe(false);
	expect(JSON.stringify(initialMessages)).toContain(prompt);

	expect(continuation.continuation).toBe(true);
	expect(continuation.owner).toBe(initial.owner);
	expect(continuation.body.parentRunId).toBe(initial.body.runId);
	expect(continuation.body.resume).toHaveLength(1);
	const resume = JSON.stringify(continuation.body.resume);
	expect(resume).toContain("call-draft-1");
	expect(resume).toContain("changed");

	const providerMessages = JSON.stringify(second.messages);
	expect(providerMessages).toContain("call-draft-1");
	expect(providerMessages).toContain("changed");
});

test("a later ordinary prompt sends native history and starts exactly one new provider run", async ({
	page,
	draftChatPair: pair,
}) => {
	const dialog = await reachApproval(page, pair);
	await approve(dialog);
	const continuation = await pair.waitForProviderRun(2);
	await continuation.finished;
	await expect(footerStatus(page)).toHaveText("");
	await expect(draftOutcome(page)).toHaveText(/^Draft changed\./);


	const followUp = "Write a second answer.";
	await submitPrompt(page, followUp);
	const third = await pair.waitForProviderRun(3);
	await third.finished;
	await expect(footerStatus(page)).toHaveText("");

	const transcript = page.getByRole("list", { name: "Chat messages" });
	await expect(transcript.locator('li[data-role="user"]')).toHaveCount(2);
	await expect(transcript.locator('li[data-role="assistant"]')).toHaveCount(3);
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(draftOutcome(page)).toHaveCount(0);
	await expect(page.getByRole("textbox", { name: "Ask Agent" })).toHaveValue("");

	expect(pair.posts).toHaveLength(3);
	expect(pair.providerRuns).toHaveLength(3);

	const initial = pair.posts[0];
	const followUpPost = pair.posts[2];
	if (!(initial && followUpPost)) {
		throw new Error("Expected the initial and follow-up transport requests.");
	}
	expect(followUpPost.continuation).toBe(false);
	expect(followUpPost.owner).toBe(initial.owner);
	expect(followUpPost.body.runId).not.toBe(initial.body.runId);
	expect(followUpPost.body.parentRunId ?? null).toBeNull();
	expect(followUpPost.body.resume ?? []).toHaveLength(0);

	const history = followUpPost.body.messages ?? [];
	expect(history.filter((message) => message.role === "user")).toHaveLength(2);
	const wireHistory = JSON.stringify(history);
	expect(wireHistory).toContain(prompt);
	expect(wireHistory).toContain(followUp);
	expect(wireHistory).toContain("call-draft-1");
	expect(wireHistory).toContain("changed");

	const providerHistory = JSON.stringify(third.messages);
	expect(providerHistory).toContain(prompt);
	expect(providerHistory).toContain(followUp);
	expect(providerHistory).toContain("call-draft-1");
	expect(providerHistory).toContain("changed");
});

test("Stop during the approval dialog closes it without a continuation request or mutation", async ({
	page,
	draftChatPair: pair,
}) => {
	const dialog = await reachApproval(page, pair);
	await dialog.getByRole("button", { name: "Stop", exact: true }).click();

	await expect(dialog).toBeHidden();
	const first = await pair.waitForProviderRun(1);
	await first.finished;
	await expect(footerStatus(page)).toHaveText("Response stopped");
	const reopened = await openConnections(page);
	await expect(reopened).toBeChecked();
	await expect(page.getByRole("textbox", { name: "Ask Agent" })).toHaveValue("");
	await expect(draftOutcome(page)).toHaveCount(0);

	expect(pair.posts).toHaveLength(1);
	expect(pair.providerRuns).toHaveLength(1);
});

test("Deny reports denial and continues once without changing the draft", async ({
	page,
	draftChatPair: pair,
}) => {
	const dialog = await reachApproval(page, pair);
	await dialog.getByRole("button", { name: "Deny", exact: true }).click();
	await expect(dialog).toBeHidden();

	const second = await pair.waitForProviderRun(2);
	await second.finished;
	await expect(footerStatus(page)).toHaveText("");
	await expect(draftOutcome(page)).toHaveText("Draft edit denied.");
	await expect(page.getByRole("textbox", { name: "Ask Agent" })).toHaveValue("");

	expect(pair.posts).toHaveLength(2);
	expect(pair.providerRuns).toHaveLength(2);
	expect(JSON.stringify(pair.posts[1]?.body.resume)).toContain("denied");
});

test("revoking the grant while approval waits cancels the edit and the continuation reports it", async ({
	page,
	draftChatPair: pair,
}) => {
	const dialog = await reachApproval(page, pair);

	await dialog
		.getByRole("button", { name: "Revoke draft access", exact: true })
		.click();

	await expect(dialog).toBeHidden();
	const reopened = await openConnections(page);
	await expect(reopened).not.toBeChecked();
	const second = await pair.waitForProviderRun(2);
	await second.finished;
	await expect(footerStatus(page)).toHaveText("");
	await expect(draftOutcome(page)).toHaveText("Draft edit cancelled.");
	await expect(page.getByRole("textbox", { name: "Ask Agent" })).toHaveValue("");

	expect(pair.posts).toHaveLength(2);
	expect(pair.providerRuns).toHaveLength(2);
	expect(JSON.stringify(pair.posts[1]?.body.resume)).toContain("cancelled");
});

test("Stop after the edit commits keeps the change but starts no provider run", async ({
	page,
	draftChatPair: pair,
}) => {
	const dialog = await reachApproval(page, pair);

	await holdContinuation(page);
	await approve(dialog);
	await expect(page.getByRole("textbox", { name: "Ask Agent" })).toHaveValue(
		pair.draftValue,
	);
	await expect(draftOutcome(page)).toHaveText(/^Draft changed\./);

	// The tool result is ready, so the client tries to submit its continuation.
	// The page gate holds that POST before it reaches the network; Stop then
	// aborts the request while it is still unsubmitted.
	await waitForBlockedContinuation(page);
	const composerStop = page
		.locator('form[aria-label="Start a new chat"]')
		.getByRole("button", { name: "Stop", exact: true });
	await composerStop.click();
	await releaseContinuation(page);
	await waitForContinuationOutcome(page);
	expect(
		await page.evaluate(
			() => (window as GateWindow).__draftContinuationOutcome,
		),
	).toBe("aborted");

	await expect(
		page.getByRole("button", { name: "Submit prompt", exact: true }),
	).toBeEnabled();
	await expect(footerStatus(page)).toHaveText("Response stopped");
	await expect(draftOutcome(page)).toHaveText(/^Draft changed\./);
	await expect(workspaceAlert(page)).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);

	expect(pair.posts).toHaveLength(1);
	expect(pair.providerRuns).toHaveLength(1);
});

test("losing the continuation acknowledgement reports the lost confirmation and replay starts no provider run", async ({
	page,
	draftChatPair: pair,
}) => {
	const dialog = await reachApproval(page, pair);

	pair.loseNextContinuationAck();
	await approve(dialog);

	const continuation = await pair.waitForPost(2);
	const second = await pair.waitForProviderRun(2);
	await second.finished;
	await continuation.ackLost;

	await expect(footerStatus(page)).toHaveText("");
	await expect(workspaceAlert(page)).toHaveText(
		"Could not confirm the response after the draft action. Check the draft before starting a new turn.",
	);
	await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
	await expect(page.getByRole("textbox", { name: "Ask Agent" })).toHaveValue(
		pair.draftValue,
	);
	await expect(draftOutcome(page)).toHaveText(/^Draft changed\./);

	expect(pair.posts).toHaveLength(2);
	expect(pair.providerRuns).toHaveLength(2);

	const replay = await pair.replay(continuation);
	expect(replay.status).toBe(409);
	await replay.text();
	expect(pair.providerRuns).toHaveLength(2);
	expect(pair.posts).toHaveLength(2);

	// The consumed record must not trap the next turn: a fresh prompt starts
	// exactly one provider run, with no repeated draft action.
	const followUp = "Write a second answer.";
	await submitPrompt(page, followUp);
	const thirdPost = await pair.waitForPost(3);
	const third = await pair.waitForProviderRun(3);
	await third.finished;
	await expect(footerStatus(page)).toHaveText("");
	await expect(page.getByRole("list", { name: "Chat messages" }).locator("li[data-role='user']")).toHaveCount(2);
	await expect(page.getByText("Second answer.", { exact: true })).toBeVisible();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(draftOutcome(page)).toHaveCount(0);

	expect(pair.posts).toHaveLength(3);
	expect(pair.providerRuns).toHaveLength(3);
	expect(thirdPost.continuation).toBe(false);
	expect(thirdPost.body?.parentRunId).toBeUndefined();
	expect(thirdPost.body?.resume ?? []).toHaveLength(0);
	expect(thirdPost.owner).toBe(continuation.owner);

	const wireHistory = JSON.stringify(thirdPost.body?.messages);
	expect(wireHistory).toContain(prompt);
	expect(wireHistory).toContain(followUp);
	expect(wireHistory).toContain("call-draft-1");
	expect(wireHistory).toContain("changed");
	expect(
		third.chunks.some((chunk) => chunk.type === "TOOL_CALL_START"),
	).toBe(false);
});
