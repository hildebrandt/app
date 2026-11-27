import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible';
import { serve } from 'srvx';

const CHAT_PATH = '/api/chat';
const HOSTNAME = '127.0.0.1';
const DEFAULT_PORT = 3002;
const PROVIDER_BASE_URL = 'http://192.168.10.2:30129/v1';
const PROVIDER_MODEL = 'default';
const PROVIDER_TIMEOUT_MS = 60_000;
const MAX_THREAD_ID_LENGTH = 256;
const MAX_RUN_ID_LENGTH = 256;

export const GENERIC_FAILURE_MESSAGE = 'Chat is unavailable. Try again.';

const CHAT_FAILURE_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'text/plain; charset=utf-8',
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const failureResponse = (status) =>
  new Response(GENERIC_FAILURE_MESSAGE, {
    status,
    headers: CHAT_FAILURE_HEADERS,
  });

const readRunId = (chunk) => {
  const direct = chunk.runId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const nested = chunk.metadata?.tanstack?.runId;
  return typeof nested === 'string' && nested.length > 0 ? nested : undefined;
};

const readThreadId = (chunk) => {
  const direct = chunk.threadId;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const nested = chunk.metadata?.tanstack?.threadId;
  return typeof nested === 'string' && nested.length > 0 ? nested : undefined;
};

const runErrorChunk = (threadId, runId) => ({
  type: 'RUN_ERROR',
  timestamp: Date.now(),
  message: GENERIC_FAILURE_MESSAGE,
  ...(threadId === undefined ? {} : { threadId }),
  ...(runId === undefined ? {} : { runId }),
});

const toChatMessages = (body) => {
  if (!isRecord(body)) return undefined;
  if (
    typeof body.threadId !== 'string' ||
    body.threadId.length === 0 ||
    body.threadId.length > MAX_THREAD_ID_LENGTH
  ) {
    return undefined;
  }
  if (!Array.isArray(body.messages)) return undefined;

  const messages = [];
  let hasUserMessage = false;

  for (const message of body.messages) {
    if (!isRecord(message)) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (typeof message.content !== 'string' || message.content.length === 0) continue;

    messages.push({ role: message.role, content: message.content });
    if (message.role === 'user') hasUserMessage = true;
  }

  if (!hasUserMessage) return undefined;

  const runId =
    typeof body.runId === 'string' &&
    body.runId.length > 0 &&
    body.runId.length <= MAX_RUN_ID_LENGTH
      ? body.runId
      : undefined;

  return { threadId: body.threadId, runId, messages };
};

const sanitizeStream = (source, { threadId, runId, abortController }) =>
  (async function* sanitizedChatStream() {
    let currentThreadId = threadId;
    let currentRunId = runId;

    try {
      for await (const chunk of source) {
        if (chunk.type === 'RUN_STARTED') {
          currentThreadId = readThreadId(chunk) ?? currentThreadId;
          currentRunId = readRunId(chunk) ?? currentRunId;
          yield chunk;
          continue;
        }

        if (chunk.type === 'RUN_ERROR') {
          currentThreadId = readThreadId(chunk) ?? currentThreadId;
          currentRunId = readRunId(chunk) ?? currentRunId;
          yield runErrorChunk(currentThreadId, currentRunId);
          return;
        }

        yield chunk;
      }
    } catch {
      if (!abortController.signal.aborted) yield runErrorChunk(currentThreadId, currentRunId);
    }
  })();

export const createChatHandler = (options = {}) => {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  let adapter;

  const getAdapter = () => {
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error('LLM_API_KEY is not configured.');
    }
    adapter ??= openaiCompatibleText(PROVIDER_MODEL, {
      baseURL: PROVIDER_BASE_URL,
      apiKey,
      api: 'chat-completions',
      maxRetries: 0,
      timeout: PROVIDER_TIMEOUT_MS,
      logLevel: 'off',
    });
    return adapter;
  };

  const createStream =
    options.createStream ??
    (({ messages, threadId, runId, abortController }) =>
      chat({
        adapter: getAdapter(),
        messages,
        threadId,
        abortController,
        debug: false,
        ...(runId === undefined ? {} : { runId }),
      }));

  return async (request) => {
    const { pathname } = new URL(request.url);

    if (pathname !== CHAT_PATH) {
      return new Response('Not Found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response(GENERIC_FAILURE_MESSAGE, {
        status: 405,
        headers: { ...CHAT_FAILURE_HEADERS, allow: 'POST' },
      });
    }

    let chatMessages;
    try {
      chatMessages = toChatMessages(await request.json());
    } catch {
      return failureResponse(400);
    }

    if (chatMessages === undefined) return failureResponse(400);

    const abortController = new AbortController();
    const onRequestAbort = () => abortController.abort(request.signal.reason);
    if (request.signal.aborted) onRequestAbort();
    else request.signal.addEventListener('abort', onRequestAbort, { once: true });

    let stream;
    try {
      stream = createStream({ ...chatMessages, abortController });
    } catch {
      request.signal.removeEventListener('abort', onRequestAbort);
      return failureResponse(500);
    }

    return toServerSentEventsResponse(
      sanitizeStream(stream, { ...chatMessages, abortController }),
      { abortController },
    );
  };
};

const parsePort = (value) => {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('BACKEND_PORT must be an integer from 1 to 65535.');
  }
  return port;
};

export const startServer = (options = {}) =>
  serve({
    hostname: HOSTNAME,
    port: parsePort(options.port ?? process.env.BACKEND_PORT),
    fetch: createChatHandler(options),
  });

if (import.meta.main) startServer();
