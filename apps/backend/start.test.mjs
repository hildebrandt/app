import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler, GENERIC_FAILURE_MESSAGE } from './start.mjs';

const CHAT_URL = 'http://127.0.0.1:3002/api/chat';

const chatRequest = (payload) =>
  new Request(CHAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

const parseEvents = (text) =>
  text
    .split('\n\n')
    .filter((event) => event.trim().length > 0)
    .map((event) => JSON.parse(event.split('\n').find((line) => line.startsWith('data: ')).slice(6)));

const runStarted = { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1', timestamp: 1 };
const runFinished = { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1', timestamp: 2 };

test('forwards only user and assistant text to the provider', async () => {
  let captured;
  const handler = createChatHandler({
    createStream: (input) => {
      captured = input;
      return (async function* () {
        yield runStarted;
        yield runFinished;
      })();
    },
  });

  const response = await handler(
    chatRequest({
      threadId: 'thread-1',
      runId: 'run-1',
      messages: [
        { id: 'u1', role: 'user', content: 'Hello' },
        { id: 'a1', role: 'assistant', content: 'Hi' },
        { id: 'a2', role: 'assistant' },
        { id: 'r1', role: 'reasoning', content: 'private reasoning' },
        { id: 't1', role: 'tool', toolCallId: 'call-1', content: 'tool output' },
        { id: 's1', role: 'system', content: 'ignored' },
      ],
      tools: [{ name: 'dangerous-tool' }],
      provider: 'client-provider',
      model: 'client-model',
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.deepEqual(captured.messages, [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
  ]);
  assert.equal(captured.threadId, 'thread-1');
  assert.equal(captured.runId, 'run-1');
  assert.equal(captured.tools, undefined);
  assert.equal(captured.provider, undefined);
  assert.equal(captured.model, undefined);
  assert.deepEqual(
    parseEvents(await response.text()).map((event) => event.type),
    ['RUN_STARTED', 'RUN_FINISHED'],
  );
});

test('returns the shared failure before streaming invalid input', async () => {
  const handler = createChatHandler({
    createStream: () => {
      throw new Error('createStream must not run for invalid input');
    },
  });

  const bodies = [
    '{not json',
    JSON.stringify({ threadId: 'thread-1', messages: [{ role: 'reasoning', content: 'x' }] }),
    JSON.stringify({ threadId: '', messages: [{ role: 'user', content: 'x' }] }),
  ];

  for (const body of bodies) {
    const response = await handler(chatRequest(body));
    assert.equal(response.status, 400);
    assert.equal(await response.text(), GENERIC_FAILURE_MESSAGE);
  }
});

test('does not expose setup failures', async () => {
  const handler = createChatHandler({ apiKey: '' });
  const response = await handler(
    chatRequest({ threadId: 'thread-1', messages: [{ role: 'user', content: 'Hello' }] }),
  );

  assert.equal(response.status, 500);
  assert.equal(await response.text(), GENERIC_FAILURE_MESSAGE);
});

test('replaces provider failures with a generic RUN_ERROR', async () => {
  const secret = 'sk-provider-secret-should-not-leak';
  const createStreams = [
    () => (async function* () {
      yield runStarted;
      yield {
        type: 'RUN_ERROR',
        timestamp: 3,
        message: secret,
        code: 'provider_error',
        error: { message: secret },
        rawText: secret,
      };
    })(),
    () => (async function* () {
      yield runStarted;
      throw new Error(secret);
    })(),
  ];

  for (const createStream of createStreams) {
    const handler = createChatHandler({ createStream });
    const response = await handler(
      chatRequest({ threadId: 'thread-1', runId: 'run-1', messages: [{ role: 'user', content: 'Hello' }] }),
    );
    const text = await response.text();
    const events = parseEvents(text);
    const error = events.at(-1);

    assert.equal(text.includes(secret), false);
    assert.equal(events.map((event) => event.type).join(','), 'RUN_STARTED,RUN_ERROR');
    assert.equal(error.message, GENERIC_FAILURE_MESSAGE);
    assert.equal(error.runId ?? error.metadata?.tanstack?.runId, 'run-1');
    assert.equal(error.threadId ?? error.metadata?.tanstack?.threadId, 'thread-1');
  }
});

test('aborts the provider stream when the response is cancelled', async () => {
  let providerAbortController;
  let sourceReturned = false;

  const handler = createChatHandler({
    createStream: ({ abortController }) => {
      providerAbortController = abortController;
      return (async function* () {
        try {
          yield runStarted;
          await new Promise((resolve) => abortController.signal.addEventListener('abort', resolve, { once: true }));
          yield runFinished;
        } finally {
          sourceReturned = true;
        }
      })();
    },
  });

  const response = await handler(
    chatRequest({ threadId: 'thread-1', messages: [{ role: 'user', content: 'Hello' }] }),
  );
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();

  assert.equal(providerAbortController.signal.aborted, true);
  assert.equal(sourceReturned, true);
});
