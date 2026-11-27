import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { test as base } from "@playwright/test";

/**
 * Phase 4 release harness: the real built web app in front of the real
 * backend handler, with a scripted text adapter and a recording transport.
 *
 * The web build must be current before running these tests
 * (`pnpm --filter web build`). The build is loaded from apps/web/dist and
 * reads CHAT_BACKEND_URL and CHAT_OWNER_SECRET from the process environment.
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const webDir = path.join(repoRoot, "apps/web");
const backendEntry = path.join(repoRoot, "apps/backend/start.mjs");
const ownerSecret = "phase4-draft-chat-owner-secret-0123456789abcdef";
const draftValue = "Draft proposed by the scripted agent.";
const toolCallId = "call-draft-1";

type FetchHandler = (request: Request) => Response | Promise<Response>;

type ServerHandle = {
	url?: string;
	ready: () => Promise<unknown>;
	close: (closeActiveConnections?: boolean) => Promise<void>;
};

type Serve = (options: {
	fetch: FetchHandler;
	hostname: string;
	port: number;
	silent?: boolean;
}) => ServerHandle;

type WebStart = (options: {
	environment: Record<string, string>;
	port: number;
}) => Promise<ServerHandle>;

export type ChatBody = {
	threadId?: string;
	runId?: string;
	parentRunId?: string;
	resume?: unknown[];
	messages?: Array<{
		role?: string;
		content?: unknown;
		toolCallId?: string;
	}>;
	[key: string]: unknown;
};

export type ProviderRun = {
	index: number;
	options: Record<string, unknown>;
	messages: readonly unknown[];
	chunks: Array<Record<string, unknown>>;
	started: Promise<void>;
	finished: Promise<void>;
	aborted: Promise<void>;
	release: () => boolean;
	waitForHold: () => Promise<void>;
};

export type TransportPost = {
	index: number;
	pathname: string;
	body: ChatBody;
	rawBody: string;
	owner: string | null;
	continuation: boolean;
	ackLost: Promise<void>;
};

export type DraftChatPair = {
	webUrl: string;
	backendUrl: string;
	draftValue: string;
	providerRuns: ProviderRun[];
	posts: TransportPost[];
	waitForProviderRun: (index: number) => Promise<ProviderRun>;
	waitForPost: (index: number) => Promise<TransportPost>;
	releaseProviderRun: (index: number) => Promise<void>;
	loseNextContinuationAck: () => void;
	replay: (post: TransportPost) => Promise<Response>;
	close: () => Promise<void>;
};

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
};

const withResolvers = <T>(): Deferred<T> =>
	(
		Promise as typeof Promise & {
			withResolvers: <U>() => Deferred<U>;
		}
	).withResolvers<T>();

type Gate = { promise: Promise<void>; release: () => boolean };

function gate(): Gate {
	const settle = withResolvers<void>();
	let released = false;
	return {
		promise: settle.promise,
		release: () => {
			if (released) {
				return false;
			}
			released = true;
			settle.resolve();
			return true;
		},
	};
}

function backToLoopback(raw: string | undefined): string {
	if (!raw) {
		throw new Error("The disposable server did not publish a URL.");
	}
	const url = new URL(raw);
	url.hostname = "127.0.0.1";
	return url.origin;
}

class RunHandle implements ProviderRun {
	readonly index: number;
	readonly options: Record<string, unknown>;
	readonly messages: readonly unknown[];
	readonly chunks: Array<Record<string, unknown>> = [];
	readonly started: Promise<void>;
	readonly finished: Promise<void>;
	readonly aborted: Promise<void>;

	private readonly startedDeferred = withResolvers<void>();
	private readonly finishedDeferred = withResolvers<void>();
	private readonly abortedDeferred = withResolvers<void>();
	private currentGate: Gate | null = null;
	private holdArmed: Deferred<void> | null = null;
	private abortedFlag = false;

	constructor(
		index: number,
		options: Record<string, unknown>,
	) {
		this.index = index;
		this.options = options;
		this.messages = Array.isArray(options.messages) ? options.messages : [];
		this.started = this.startedDeferred.promise;
		this.finished = this.finishedDeferred.promise;
		this.aborted = this.abortedDeferred.promise;
	}

	markStarted(): void {
		this.startedDeferred.resolve();
	}

	markAborted(): void {
		if (this.abortedFlag) {
			return;
		}
		this.abortedFlag = true;
		this.abortedDeferred.resolve();
		this.release();
	}

	get abortedBySignal(): boolean {
		return this.abortedFlag;
	}

	markFinished(): void {
		this.finishedDeferred.resolve();
	}

	armHold(): Gate {
		const next = gate();
		this.currentGate = next;
		this.holdArmed?.resolve();
		this.holdArmed = null;
		if (this.abortedFlag) {
			next.release();
		}
		return next;
	}

	release = (): boolean => {
		const current = this.currentGate;
		if (current === null) {
			return false;
		}
		this.currentGate = null;
		return current.release();
	};

	waitForHold = async (): Promise<void> => {
		if (this.currentGate !== null || this.abortedFlag) {
			return;
		}
		this.holdArmed ??= withResolvers<void>();
		await this.holdArmed.promise;
	};
}

class ScriptedAgent {
	readonly runs: RunHandle[] = [];
	readonly model = "phase4-scripted-model";
	readonly name = "phase4-scripted";
	readonly kind = "text";

	private readonly runWaiters = new Map<number, Deferred<RunHandle>[]>();
	private readonly targetValue: string;

	constructor(targetValue: string) {
		this.targetValue = targetValue;
	}

	async waitForRun(index: number): Promise<RunHandle> {
		const existing = this.runs[index - 1];
		if (existing !== undefined) {
			return existing;
		}
		const waiter = withResolvers<RunHandle>();
		const waiters = this.runWaiters.get(index) ?? [];
		waiters.push(waiter);
		this.runWaiters.set(index, waiters);
		return waiter.promise;
	}

	async *chatStream(
		options: Record<string, unknown>,
	): AsyncGenerator<Record<string, unknown>> {
		const request = options.request as { signal?: AbortSignal } | undefined;
		const abortController = options.abortController as
			| AbortController
			| undefined;
		const signal = request?.signal ?? abortController?.signal;
		const index = this.runs.length + 1;
		const run = new RunHandle(index, options);
		this.runs.push(run);
		const waiting = this.runWaiters.get(index);
		if (waiting) {
			this.runWaiters.delete(index);
			for (const waiter of waiting) {
				waiter.resolve(run);
			}
		}

		const onAbort = (): void => run.markAborted();
		if (signal?.aborted) {
			run.markAborted();
		} else {
			signal?.addEventListener("abort", onAbort, { once: true });
		}

		const runId =
			typeof options.runId === "string" ? options.runId : `draft-run-${index}`;
		const threadId =
			typeof options.threadId === "string" ? options.threadId : "";
		const parentRunId =
			typeof options.parentRunId === "string"
				? options.parentRunId
				: undefined;

		try {
			run.markStarted();
			yield {
				type: "RUN_STARTED",
				runId,
				threadId,
				model: this.model,
				timestamp: Date.now(),
				...(parentRunId ? { parentRunId } : {}),
			};

			if (index === 1) {
				yield* this.firstTurn(runId, run);
			} else if (index === 2) {
				yield* this.finalTurn(runId);
			} else if (index === 3) {
				yield* this.followUpTurn(runId);
			} else {
				yield {
					type: "RUN_ERROR",
					model: this.model,
					timestamp: Date.now(),
					message: "Unexpected scripted provider run.",
					error: { message: "Unexpected scripted provider run." },
				};
				return;
			}

			if (run.abortedBySignal) {
				return;
			}

			yield {
				type: "RUN_FINISHED",
				runId,
				threadId,
				model: this.model,
				timestamp: Date.now(),
				finishReason: index === 1 ? "tool_calls" : "stop",
				usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
			};
		} finally {
			signal?.removeEventListener("abort", onAbort);
			run.markFinished();
		}
	}

	private async *firstTurn(
		runId: string,
		run: RunHandle,
	): AsyncGenerator<Record<string, unknown>> {
		const messageId = `${runId}-text`;
		yield {
			type: "TEXT_MESSAGE_START",
			messageId,
			role: "assistant",
			model: this.model,
			timestamp: Date.now(),
		};
		yield {
			type: "TEXT_MESSAGE_CONTENT",
			messageId,
			delta: "I can update the draft.",
			model: this.model,
			timestamp: Date.now(),
		};
		yield {
			type: "TEXT_MESSAGE_END",
			messageId,
			model: this.model,
			timestamp: Date.now(),
		};

		yield {
			type: "TOOL_CALL_START",
			toolCallId,
			toolCallName: "set_draft",
			model: this.model,
			timestamp: Date.now(),
			index: 0,
		};
		yield {
			type: "TOOL_CALL_ARGS",
			toolCallId,
			delta: JSON.stringify({ value: this.targetValue }),
			model: this.model,
			timestamp: Date.now(),
		};
		yield {
			type: "TOOL_CALL_END",
			toolCallId,
			model: this.model,
			timestamp: Date.now(),
		};

		const held = run.armHold();
		await held.promise;
	}

	private *finalTurn(runId: string): Generator<Record<string, unknown>> {
		const messageId = `${runId}-text`;
		yield {
			type: "TEXT_MESSAGE_START",
			messageId,
			role: "assistant",
			model: this.model,
			timestamp: Date.now(),
		};
		yield {
			type: "TEXT_MESSAGE_CONTENT",
			messageId,
			delta: "Draft is ready. Send it when you want.",
			model: this.model,
			timestamp: Date.now(),
		};
		yield {
			type: "TEXT_MESSAGE_END",
			messageId,
			model: this.model,
			timestamp: Date.now(),
		};
	}
	private *followUpTurn(runId: string): Generator<Record<string, unknown>> {
		const messageId = `${runId}-text`;
		yield {
			type: "TEXT_MESSAGE_START",
			messageId,
			role: "assistant",
			model: this.model,
			timestamp: Date.now(),
		};
		yield {
			type: "TEXT_MESSAGE_CONTENT",
			messageId,
			delta: "Second answer.",
			model: this.model,
			timestamp: Date.now(),
		};
		yield {
			type: "TEXT_MESSAGE_END",
			messageId,
			model: this.model,
			timestamp: Date.now(),
		};
	}


	structuredOutput(): Promise<never> {
		return Promise.reject(
			new Error("The scripted adapter does not support structured output."),
		);
	}
}

class ScriptedTransport {
	readonly posts: TransportPost[] = [];

	private readonly handler: FetchHandler;
	private readonly postWaiters = new Map<number, Deferred<TransportPost>[]>();
	private loseAck = false;

	constructor(handler: FetchHandler) {
		this.handler = handler;
	}

	armLostAck(): void {
		this.loseAck = true;
	}

	async waitForPost(index: number): Promise<TransportPost> {
		const existing = this.posts[index - 1];
		if (existing !== undefined) {
			return existing;
		}
		const waiter = withResolvers<TransportPost>();
		const waiters = this.postWaiters.get(index) ?? [];
		waiters.push(waiter);
		this.postWaiters.set(index, waiters);
		return waiter.promise;
	}

	async fetch(request: Request): Promise<Response> {
		const index = this.posts.length + 1;
		const url = new URL(request.url);
		const rawBody = await request.clone().text();
		let body: ChatBody = {};
		try {
			body = JSON.parse(rawBody) as ChatBody;
		} catch {
			body = {};
		}

		const ackLost = withResolvers<void>();
		const post: TransportPost = {
			index,
			pathname: url.pathname,
			body,
			rawBody,
			owner: request.headers.get("x-agent-chat-owner"),
			continuation: Array.isArray(body.resume) && body.resume.length > 0,
			ackLost: ackLost.promise,
		};

		this.posts.push(post);
		const waiters = this.postWaiters.get(index);
		if (waiters) {
			this.postWaiters.delete(index);
			for (const waiter of waiters) {
				waiter.resolve(post);
			}
		}

		const response = await this.handler(request);
		if (!post.continuation || !this.loseAck || !response.ok) {
			return response;
		}
		this.loseAck = false;
		// The provider accepts and completes the real run; the browser receives no acknowledgement.
		await response.arrayBuffer();
		ackLost.resolve();
		return new Response(null, { status: 502 });
	}
}

async function startPair(): Promise<DraftChatPair> {
	process.env.NODE_ENV = "production";
	process.env.HOST = "127.0.0.1";
	process.env.CHAT_OWNER_SECRET = ownerSecret;

	const backendRequire = createRequire(backendEntry);
	const srvxEntry = backendRequire.resolve("srvx");
	// Runtime-resolved: srvx lives in a pnpm package path, and the built web
	// server must only be imported after the fixture changes into apps/web.
	const { serve } = (await import(pathToFileURL(srvxEntry).href)) as {
		serve: Serve;
	};
	const { createChatHandler } = (await import(
		pathToFileURL(backendEntry).href
	)) as {
		createChatHandler: (options: { adapter: ScriptedAgent }) => FetchHandler;
	};

	const agent = new ScriptedAgent(draftValue);
	const backendHandler = createChatHandler({ adapter: agent });
	const transport = new ScriptedTransport(backendHandler);

	const backendServer = serve({
		fetch: (request) => transport.fetch(request),
		hostname: "127.0.0.1",
		port: 0,
		silent: true,
	});
	await backendServer.ready();
	const backendUrl = backToLoopback(backendServer.url);
	process.env.CHAT_BACKEND_URL = backendUrl;

	const previousCwd = process.cwd();
	process.chdir(webDir);
	let webServer: ServerHandle | null = null;
	try {
		const { start } = (await import(
			pathToFileURL(path.join(webDir, "start.mjs")).href
		)) as { start: WebStart };
		webServer = await start({ environment: { PORT: "0" }, port: 0 });
		await webServer.ready();
	} catch (error) {
		await backendServer.close(true).catch(() => undefined);
		throw error;
	} finally {
		process.chdir(previousCwd);
	}
	if (webServer === null) {
		await backendServer.close(true).catch(() => undefined);
		throw new Error("The web server did not start.");
	}
	const webUrl = backToLoopback(webServer.url);

	return {
		webUrl,
		backendUrl,
		draftValue,
		get providerRuns() {
			return agent.runs;
		},
		get posts() {
			return transport.posts;
		},
		waitForProviderRun: (index) => agent.waitForRun(index),
		waitForPost: (index) => transport.waitForPost(index),
		releaseProviderRun: async (index) => {
			const run = await agent.waitForRun(index);
			await run.waitForHold();
			run.release();
		},
		loseNextContinuationAck: () => {
			transport.armLostAck();
		},
		replay: async (post) => {
			const headers = new Headers({ "content-type": "application/json" });
			if (post.owner !== null) {
				headers.set("x-agent-chat-owner", post.owner);
			}
			return backendHandler(
				new Request(`http://127.0.0.1${post.pathname}`, {
					method: "POST",
					headers,
					body: post.rawBody,
				}),
			);
		},
		close: async () => {
			for (const run of agent.runs) {
				run.release();
			}
			await Promise.allSettled([
				webServer.close(true),
				backendServer.close(true),
			]);
		},
	};
}

type Fixtures = {
	draftChatPair: DraftChatPair;
};

export const test = base.extend<Fixtures>({
	draftChatPair: async ({ }, use) => {
		const pair = await startPair();
		try {
			await use(pair);
		} finally {
			await pair.close();
		}
	},
});

export const expect = test.expect;
