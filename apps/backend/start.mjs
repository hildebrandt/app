import {
  chat,
  chatParamsFromRequestBody,
  EventType,
  toolDefinition,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { serve } from "srvx";

import {
  parseSetDraftInput,
  setDraftToolSpec,
} from "../../packages/agent-chat-contract/set-draft.mjs";
import {
  readChatOwnerSecret,
  verifyChatOwner,
} from "../../packages/agent-chat-contract/owner.mjs";
import {
  createContinuationStore,
  DEFAULT_CONTINUATION_TTL_MS,
  DEFAULT_MAX_CONTINUATION_RECORDS,
  prepareChatRequest,
} from "./continuation.mjs";

const CHAT_PATH = "/api/chat";
const HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 3001;

// oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Provider transport is a fixed LAN HTTP endpoint that must stay unchanged.
const PROVIDER_BASE_URL = "http://192.168.10.2:30129/v1";
const PROVIDER_MODEL = "default";
const PROVIDER_TIMEOUT_MS = 60_000;
const MAX_THREAD_ID_LENGTH = 256;
const MAX_RUN_ID_LENGTH = 256;
const CLIENT_CLOSED_REQUEST_STATUS = 499;
const MAX_TOOL_CALL_ID_LENGTH = 256;
const MAX_TOOL_ARGUMENTS_LENGTH = 8192;

export const GENERIC_FAILURE_MESSAGE = "Chat is unavailable. Try again.";

const CHAT_FAILURE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
};

const SET_DRAFT_TOOL = toolDefinition(setDraftToolSpec);

/** @typedef {import("@tanstack/ai").RunAgentResumeItem} ResumeEntry */
/** @typedef {typeof SET_DRAFT_TOOL} ToolSpec */
/** @typedef {import("@tanstack/ai").AnyTextAdapter} ChatAdapter */

/**
 * @typedef {object} ChatOptions
 * @property {ChatAdapter} adapter
 * @property {boolean} debug
 * @property {import("@tanstack/ai").ModelMessage[]} messages
 * @property {string} threadId
 * @property {AbortController} abortController
 * @property {string} [runId]
 * @property {string} [parentRunId]
 * @property {ResumeEntry[]} [resume]
 * @property {ToolSpec[]} [tools]
 */

/**
 * @typedef {object} StreamInput
 * @property {import("@tanstack/ai").ModelMessage[]} messages
 * @property {string} threadId
 * @property {string} [runId]
 * @property {string} [parentRunId]
 * @property {ResumeEntry[]} [resume]
 * @property {ToolSpec[]} [tools]
 * @property {AbortController} abortController
 */

/**
 * @typedef {object} HandlerOptions
 * @property {string} [apiKey]
 * @property {ChatAdapter} [adapter]
 * @property {string} [ownerSecret]
 * @property {number} [continuationTtlMs]
 * @property {number} [maxContinuationRecords]
 * @property {() => number} [now]
 * @property {(input: StreamInput) => import("@tanstack/ai").ChatStream} [createStream]
 */

/** @typedef {{ threadId?: unknown, runId?: unknown, metadata?: { tanstack?: { threadId?: unknown, runId?: unknown } } }} RunIdentifiers */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Parsed JSON must be an object before its fields can be read.
  typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {number} status HTTP status for the generic failure. */
const failureResponse = (status) =>
  new Response(GENERIC_FAILURE_MESSAGE, {
    status,
    headers: CHAT_FAILURE_HEADERS,
  });

/** @param {RunIdentifiers} chunk Provider event to read the run ID from. */
const readRunId = (chunk) => {
  const direct = chunk.runId;

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted; typeof validates each field before use.
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  const nested = chunk.metadata?.tanstack?.runId;

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted; typeof validates each field before use.
  return typeof nested === "string" && nested.length > 0 ? nested : undefined;
};

/** @param {RunIdentifiers} chunk Provider event to read the thread ID from. */
const readThreadId = (chunk) => {
  const direct = chunk.threadId;

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted; typeof validates each field before use.
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  const nested = chunk.metadata?.tanstack?.threadId;

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted; typeof validates each field before use.
  return typeof nested === "string" && nested.length > 0 ? nested : undefined;
};

/** @param {string | undefined} threadId @param {string | undefined} runId */
const runErrorChunk = (threadId, runId) => {
  /** @type {import("@tanstack/ai").RunErrorEvent} */
  const chunk = {
    type: EventType.RUN_ERROR,
    timestamp: Date.now(),
    message: GENERIC_FAILURE_MESSAGE,
  };

  if (threadId !== undefined) {
    chunk.threadId = threadId;
  }

  if (runId !== undefined) {
    chunk.runId = runId;
  }

  return chunk;
};

/**
 * @param {unknown} input Parsed tool input carried by TOOL_CALL_END.
 * @param {unknown} args Final arguments string carried by TOOL_CALL_END.
 * @param {string} trackedArgs Arguments accumulated from TOOL_CALL_ARGS deltas.
 */
const readSetDraftInput = (input, args, trackedArgs) => {
  const direct = parseSetDraftInput(input);

  if (direct !== null) {
    return direct;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The final tool arguments come from the trusted provider stream.
  const finalArgs =
    typeof args === "string" && args.length > 0 ? args : trackedArgs;

  if (finalArgs.length > MAX_TOOL_ARGUMENTS_LENGTH) {
    return null;
  }

  /** @type {unknown} */
  let parsed;

  try {
    parsed = JSON.parse(finalArgs);
  } catch {
    return null;
  }

  return parseSetDraftInput(parsed);
};

/**
 * @param {import("@tanstack/ai").ChatStream} source Provider stream.
 * @param {{ threadId: string, runId: string | undefined, abortController: AbortController, owner: string | null, store: ReturnType<typeof createContinuationStore> }} input Request scope and continuation records.
 */
const sanitizeStream = (
  source,
  { threadId, runId, abortController, owner, store }
) =>
  (async function* sanitizedChatStream() {
    let currentThreadId = threadId;
    let currentRunId = runId;
    let runFinished = false;
    const stopRun = () => {
      if (owner !== null && currentRunId !== undefined) {
        store.stopRun(owner, threadId, currentRunId);
      }
    };
    const onAbort = () => {
      stopRun();
    };

    abortController.signal.addEventListener("abort", onAbort, { once: true });

    if (abortController.signal.aborted) {
      stopRun();
      abortController.signal.removeEventListener("abort", onAbort);
      return;
    }

    /** @type {Map<string, { name: string | undefined, args: string }>} */
    const calls = new Map();

    try {
      for await (const chunk of source) {
        if (chunk.type === EventType.RUN_STARTED) {
          currentThreadId = readThreadId(chunk) ?? currentThreadId;
          currentRunId = readRunId(chunk) ?? currentRunId;

          yield chunk;

          continue;
        }

        if (chunk.type === EventType.TOOL_CALL_START) {
          const { toolCallId, toolCallName } = chunk;

          if (
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted.
            typeof toolCallId === "string" &&
            toolCallId.length > 0 &&
            toolCallId.length <= MAX_TOOL_CALL_ID_LENGTH
          ) {
            calls.set(toolCallId, {
              name:
                // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted.
                typeof toolCallName === "string" ? toolCallName : undefined,
              args: "",
            });
          }

          yield chunk;

          continue;
        }

        if (chunk.type === EventType.TOOL_CALL_ARGS) {
          const { toolCallId, delta } = chunk;

          if (
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted.
            typeof toolCallId === "string" &&
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted.
            typeof delta === "string"
          ) {
            const tracked = calls.get(toolCallId);

            if (
              tracked !== undefined &&
              tracked.args.length + delta.length <= MAX_TOOL_ARGUMENTS_LENGTH
            ) {
              tracked.args += delta;
            }
          }

          yield chunk;

          continue;
        }

        if (chunk.type === EventType.TOOL_CALL_END) {
          const { toolCallId } = chunk;

          if (
            owner !== null &&
            currentRunId !== undefined &&
            !abortController.signal.aborted &&
            // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Provider stream events are untrusted.
            typeof toolCallId === "string" &&
            toolCallId.length > 0 &&
            toolCallId.length <= MAX_TOOL_CALL_ID_LENGTH
          ) {
            const tracked = calls.get(toolCallId);
            const trackedArgs = tracked?.args ?? "";

            const finalArgs = "args" in chunk ? chunk.args : undefined;

            if (tracked?.name === "set_draft") {
              const input = readSetDraftInput(
                chunk.input,
                finalArgs,
                trackedArgs
              );

              if (input !== null) {
                store.add({
                  owner,
                  threadId,
                  runId: currentRunId,
                  toolCallId,
                  input,
                });
              }
            }
          }

          yield chunk;

          continue;
        }

        if (chunk.type === EventType.RUN_FINISHED) {
          if (abortController.signal.aborted) {
            stopRun();
            return;
          }

          currentThreadId = readThreadId(chunk) ?? currentThreadId;
          currentRunId = readRunId(chunk) ?? currentRunId;
          runFinished = true;

          const outcome = chunk.outcome;
          if (outcome?.type === "interrupt") {
            if (
              owner === null ||
              currentRunId === undefined ||
              !store.finishRun(owner, threadId, currentRunId, outcome.interrupts)
            ) {
              stopRun();
              yield runErrorChunk(currentThreadId, currentRunId);
              return;
            }
          } else {
            stopRun();
            if ([...calls.values()].some(({ name }) => name === "set_draft")) {
              yield runErrorChunk(currentThreadId, currentRunId);
              return;
            }
          }

          yield chunk;

          return;
        }

        if (chunk.type === EventType.RUN_ERROR) {
          if (abortController.signal.aborted) {
            stopRun();
            return;
          }

          currentThreadId = readThreadId(chunk) ?? currentThreadId;
          currentRunId = readRunId(chunk) ?? currentRunId;
          runFinished = true;

          if (owner !== null && currentRunId !== undefined) {
            store.stopRun(owner, threadId, currentRunId);
          }

          yield runErrorChunk(currentThreadId, currentRunId);

          return;
        }

        yield chunk;
      }
    } catch {
      if (!abortController.signal.aborted) {
        yield runErrorChunk(currentThreadId, currentRunId);
      }
    } finally {
      abortController.signal.removeEventListener("abort", onAbort);

      if (!runFinished) {
        stopRun();
      }
    }
  })();

/** @param {Request} request @param {string | undefined} secret */
const readRequestOwner = (request, secret) => {
  if (secret === undefined) {
    return null;
  }

  const token = request.headers.get("x-agent-chat-owner");

  return token === null ? null : verifyChatOwner(token, secret);
};

/** @param {HandlerOptions} options Provider credentials and optional stream factory. */
export const createChatHandler = (options = {}) => {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  const ownerSecret = readChatOwnerSecret(
    options.ownerSecret ?? process.env.CHAT_OWNER_SECRET
  );
  const store = createContinuationStore({
    ttlMs: options.continuationTtlMs ?? DEFAULT_CONTINUATION_TTL_MS,
    maxRecords:
      options.maxContinuationRecords ?? DEFAULT_MAX_CONTINUATION_RECORDS,
    now: options.now,
  });

  /** @type {ReturnType<typeof openaiCompatibleText> | undefined} */
  let defaultAdapter;

  /** @returns {ChatAdapter} */
  const getAdapter = () => {
    if (options.adapter !== undefined) {
      return options.adapter;
    }

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Untrusted option or environment value; string check validates the API key at the boundary.
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("LLM_API_KEY is not configured.");
    }

    defaultAdapter ??= openaiCompatibleText(PROVIDER_MODEL, {
      baseURL: PROVIDER_BASE_URL,
      api: "chat-completions",
      maxRetries: 0,
      timeout: PROVIDER_TIMEOUT_MS,
      logLevel: "off",
      apiKey,
    });

    return defaultAdapter;
  };

  const createStream =
    options.createStream ??
    (({
      messages,
      threadId,
      runId,
      parentRunId,
      resume,
      tools,
      abortController,
    }) => {
      /** @type {ChatOptions} */
      const chatOptions = {
        adapter: getAdapter(),
        debug: false,
        messages,
        threadId,
        abortController,
      };

      if (runId !== undefined) {
        chatOptions.runId = runId;
      }

      if (parentRunId !== undefined) {
        chatOptions.parentRunId = parentRunId;
      }

      if (resume !== undefined) {
        chatOptions.resume = resume;
      }

      if (tools !== undefined && tools.length > 0) {
        chatOptions.tools = tools;
      }

      return chat(chatOptions);
    });

  /** @param {Request} request HTTP request to the backend. */
  return async (request) => {
    const { pathname } = new URL(request.url);

    if (pathname !== CHAT_PATH) {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response(GENERIC_FAILURE_MESSAGE, {
        status: 405,
        headers: { ...CHAT_FAILURE_HEADERS, allow: "POST" },
      });
    }

    if (request.signal.aborted) {
      return failureResponse(CLIENT_CLOSED_REQUEST_STATUS);
    }

    /** @type {Awaited<ReturnType<typeof chatParamsFromRequestBody>>} */
    let params;

    try {
      params = await chatParamsFromRequestBody(await request.json());
    } catch {
      return failureResponse(400);
    }

    if (
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The parser returns a string, but the boundary still checks it.
      typeof params.threadId !== "string" ||
      params.threadId.length === 0 ||
      params.threadId.length > MAX_THREAD_ID_LENGTH
    ) {
      return failureResponse(400);
    }

    const requestedRunId = params.runId;

    const runId =
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The optional run ID comes from untrusted JSON.
      typeof requestedRunId === "string" &&
      requestedRunId.length > 0 &&
      requestedRunId.length <= MAX_RUN_ID_LENGTH
        ? requestedRunId
        : undefined;

    const parentRunId = params.parentRunId;

    if (
      parentRunId !== undefined &&
      (parentRunId.length === 0 || parentRunId.length > MAX_RUN_ID_LENGTH)
    ) {
      return failureResponse(400);
    }

    const owner = readRequestOwner(request, ownerSecret);
    const decision = prepareChatRequest({
      params,
      owner,
      store,
      runId,
      parentRunId,
    });

    if ("status" in decision) {
      return failureResponse(decision.status);
    }

    const abortController = new AbortController();

    const onRequestAbort = () => {
      abortController.abort(request.signal.reason);
    };

    if (request.signal.aborted) {
      onRequestAbort();
    } else {
      request.signal.addEventListener("abort", onRequestAbort, { once: true });
    }

    /** @type {ToolSpec[] | undefined} */
    const tools = owner === null ? undefined : [SET_DRAFT_TOOL];

    let stream;

    try {
      stream = createStream({
        messages: decision.messages,
        threadId: decision.threadId,
        ...(decision.runId !== undefined && { runId: decision.runId }),
        ...(decision.parentRunId !== undefined && {
          parentRunId: decision.parentRunId,
        }),
        ...(decision.resume !== undefined && { resume: decision.resume }),
        ...(tools !== undefined && { tools }),
        abortController,
      });
    } catch {
      request.signal.removeEventListener("abort", onRequestAbort);

      return failureResponse(500);
    }

    return toServerSentEventsResponse(
      sanitizeStream(stream, {
        threadId: decision.threadId,
        runId: decision.runId,
        abortController,
        owner,
        store,
      }),
      { abortController }
    );
  };
};

/** @param {number | string | undefined} value Port from the server options or environment. */
const parsePort = (value) => {
  if (value === undefined || value === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("BACKEND_PORT must be an integer from 1 to 65535.");
  }

  return port;
};

/** @param {HandlerOptions & {port?: number | string}} options HTTP port and chat handler settings. */
export const startServer = (options = {}) =>
  serve({
    hostname: HOSTNAME,
    port: parsePort(options.port ?? process.env.BACKEND_PORT),
    fetch: createChatHandler(options),
  });

if (process.argv[1] === import.meta.filename) {
  startServer();
}
