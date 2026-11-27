import { chat, EventType, toServerSentEventsResponse } from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { serve } from "srvx";

const CHAT_PATH = "/api/chat";
const HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 3001;

// oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Provider transport is a fixed LAN HTTP endpoint that must stay unchanged.
const PROVIDER_BASE_URL = "http://192.168.10.2:30129/v1";
const PROVIDER_MODEL = "default";
const PROVIDER_TIMEOUT_MS = 60_000;
const MAX_THREAD_ID_LENGTH = 256;
const MAX_RUN_ID_LENGTH = 256;

export const GENERIC_FAILURE_MESSAGE = "Chat is unavailable. Try again.";

const CHAT_FAILURE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
};

/** @typedef {{ role: 'user' | 'assistant', content: string }} ChatMessage */
/** @typedef {{ messages: ChatMessage[], threadId: string, runId?: string, abortController: AbortController }} StreamInput */
/** @typedef {{ apiKey?: string, createStream?: (input: StreamInput) => import('@tanstack/ai').ChatStream }} HandlerOptions */
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
  /** @type {import('@tanstack/ai').RunErrorEvent} */
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

/** @param {unknown} body Untrusted chat request payload. */
const toChatMessages = (body) => {
  if (!isRecord(body)) {
    return null;
  }

  const { threadId, messages: input, runId } = body;

  const validThreadId =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate the thread ID before forwarding it.
    typeof threadId === "string" &&
    threadId.length > 0 &&
    threadId.length <= MAX_THREAD_ID_LENGTH;

  if (!validThreadId || !Array.isArray(input)) {
    return null;
  }

  /** @type {ChatMessage[]} */
  const messages = [];
  let hasUserMessage = false;

  /** @type {unknown[]} */
  const entries = input;

  for (const message of entries) {
    const { role, content } = isRecord(message) ? message : {};
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate untrusted message text before using it.
    const hasContent = typeof content === "string" && content.length > 0;

    if (!(hasContent && (role === "user" || role === "assistant"))) {
      continue;
    }

    messages.push({ role, content });

    if (role === "user") {
      hasUserMessage = true;
    }
  }

  const validRunId =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The optional run ID comes from untrusted JSON.
    typeof runId === "string" &&
    runId.length > 0 &&
    runId.length <= MAX_RUN_ID_LENGTH;

  return hasUserMessage
    ? { threadId, messages, runId: validRunId ? runId : undefined }
    : null;
};

/** @param {import('@tanstack/ai').ChatStream} source @param {Pick<StreamInput, 'threadId' | 'runId' | 'abortController'>} ids */
const sanitizeStream = (source, { threadId, runId, abortController }) =>
  (async function* sanitizedChatStream() {
    let currentThreadId = threadId;
    let currentRunId = runId;

    try {
      for await (const chunk of source) {
        if (chunk.type === EventType.RUN_STARTED) {
          currentThreadId = readThreadId(chunk) ?? currentThreadId;

          currentRunId = readRunId(chunk) ?? currentRunId;

          yield chunk;

          continue;
        }

        if (chunk.type === EventType.RUN_ERROR) {
          currentThreadId = readThreadId(chunk) ?? currentThreadId;

          currentRunId = readRunId(chunk) ?? currentRunId;

          yield runErrorChunk(currentThreadId, currentRunId);

          return;
        }

        yield chunk;
      }
    } catch {
      if (!abortController.signal.aborted) {
        yield runErrorChunk(currentThreadId, currentRunId);
      }
    }
  })();

/** @param {HandlerOptions} options Provider credentials and optional stream factory. */
export const createChatHandler = (options = {}) => {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  /** @type {ReturnType<typeof openaiCompatibleText> | undefined} */
  let adapter;

  const getAdapter = () => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Untrusted option or environment value; string check validates the API key at the boundary.
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error("LLM_API_KEY is not configured.");
    }

    adapter ??= openaiCompatibleText(PROVIDER_MODEL, {
      baseURL: PROVIDER_BASE_URL,
      api: "chat-completions",
      maxRetries: 0,
      timeout: PROVIDER_TIMEOUT_MS,
      logLevel: "off",
      apiKey,
    });

    return adapter;
  };

  const createStream =
    options.createStream ??
    (({ messages, threadId, runId, abortController }) => {
      /** @type {StreamInput & {adapter: ReturnType<typeof openaiCompatibleText>, debug: boolean}} */
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

    let chatMessages;

    try {
      chatMessages = toChatMessages(await request.json());
    } catch {
      return failureResponse(400);
    }

    if (chatMessages === null) {
      return failureResponse(400);
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

    let stream;

    try {
      stream = createStream({ ...chatMessages, abortController });
    } catch {
      request.signal.removeEventListener("abort", onRequestAbort);

      return failureResponse(500);
    }

    return toServerSentEventsResponse(
      sanitizeStream(stream, { ...chatMessages, abortController }),
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
