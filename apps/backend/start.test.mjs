/* oxlint-disable landmines/no-comments -- JSDoc supplies types for the Node ESM tests. */

import assert from "node:assert/strict";
import { once } from "node:events";

import { EventType } from "@tanstack/ai";
import { assert as assertProperty, asyncProperty, string } from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import { createChatHandler, startServer } from "./start.mjs";

const CHAT_URL = "http://127.0.0.1:3001/api/chat";
const FAILURE = "Chat is unavailable. Try again.";

const conversation = {
  threadId: "thread-1",
  messages: [{ role: "user", content: "Hello" }],
};

/** @type {import('@tanstack/ai').RunStartedEvent} */
const started = {
  type: EventType.RUN_STARTED,
  threadId: "thread-1",
  runId: "run-1",
  timestamp: 1,
};

/** @type {import('@tanstack/ai').RunFinishedEvent} */
const finished = {
  type: EventType.RUN_FINISHED,
  threadId: "thread-1",
  runId: "run-1",
  timestamp: 2,
};

/** @param {unknown} payload @param {AbortSignal} [signal] */
const chatRequest = (payload, signal) =>
  new Request(CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

/** @type {(text: string) => unknown} */
const parseJson = JSON.parse;

/** @param {string} text @returns {unknown[]} */
const parseEvents = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => parseJson(line.slice(6)));

/**
 * @param {...(import('@tanstack/ai').RunStartedEvent | import('@tanstack/ai').RunFinishedEvent | import('@tanstack/ai').RunErrorEvent)} events Provider events in stream order.
 * @yields {import('@tanstack/ai').StreamChunk} The next provider event.
 */
const stream = async function* stream(...events) {
  yield* events;
};

describe("Backend chat", () => {
  it("forwards only user and assistant text to the provider", async () => {
    /** @type {unknown[]} */
    const inputs = [];

    const handler = createChatHandler({
      createStream: ({ abortController, ...input }) => {
        inputs.push({ ...input, aborted: abortController.signal.aborted });

        return stream(started, finished);
      },
    });

    const response = await handler(
      chatRequest({
        ...conversation,
        runId: "run-1",
        messages: [
          ...conversation.messages,
          { id: "a1", role: "assistant", content: "Hi" },
          { role: "assistant" },
          { role: "assistant", content: "" },
          { role: "assistant", content: 5 },
          { role: "reasoning", content: "private reasoning" },
          { role: "tool", toolCallId: "call-1", content: "tool output" },
          { role: "system", content: "ignored" },
          null,
        ],
        tools: [{ name: "ignored-tool" }],
        provider: "client-provider",
        model: "client-model",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    expect(inputs).toStrictEqual([
      {
        threadId: "thread-1",
        runId: "run-1",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ],
        aborted: false,
      },
    ]);

    expect(parseEvents(await response.text())).toMatchObject([
      { type: "RUN_STARTED" },
      { type: "RUN_FINISHED" },
    ]);
  });

  it("drops overlong run IDs without rejecting the chat", async () => {
    await assertProperty(
      asyncProperty(
        string({ minLength: 257, maxLength: 300 }),
        async (runId) => {
          /** @type {(string | undefined)[]} */
          const forwardedIds = [];

          const handler = createChatHandler({
            createStream: (input) => {
              forwardedIds.push(input.runId);

              return stream(started, finished);
            },
          });

          const response = await handler(
            chatRequest({ ...conversation, runId })
          );

          expect(response.status).toBe(200);
          expect(forwardedIds).toStrictEqual([undefined]);

          expect(parseEvents(await response.text())).toMatchObject([
            { type: "RUN_STARTED" },
            { type: "RUN_FINISHED" },
          ]);
        }
      ),
      { seed: 42 }
    );
  });

  it("returns the shared failure before streaming invalid input", async () => {
    const handler = createChatHandler({
      createStream: () => {
        throw new Error("createStream must not run for invalid input");
      },
    });

    const requests = [
      new Request(CHAT_URL, { method: "POST", body: "{not json" }),
      ...[
        null,
        [],
        { ...conversation, messages: [{ role: "reasoning", content: "x" }] },
        { ...conversation, threadId: "" },
        { ...conversation, threadId: 7 },
        { ...conversation, threadId: "t".repeat(257) },
        { ...conversation, messages: "Hello" },
        { ...conversation, messages: [] },
      ].map((payload) => chatRequest(payload)),
    ];

    const failures = await Promise.all(
      requests.map(async (request) => {
        const response = await handler(request);

        return { status: response.status, body: await response.text() };
      })
    );

    expect(failures).toStrictEqual(
      requests.map(() => ({ status: 400, body: FAILURE }))
    );
  });

  it("serves only POST requests to the chat route", async () => {
    const handler = createChatHandler({ apiKey: "" });

    const missing = await handler(
      new Request(`${CHAT_URL}/`, { method: "POST" })
    );

    const method = await handler(new Request(CHAT_URL));

    expect({
      status: missing.status,
      body: await missing.text(),
    }).toStrictEqual({
      status: 404,
      body: "Not Found",
    });

    expect({
      status: method.status,
      allow: method.headers.get("allow"),
      cache: method.headers.get("cache-control"),
      body: await method.text(),
    }).toStrictEqual({
      status: 405,
      allow: "POST",
      cache: "no-store",
      body: FAILURE,
    });
  });

  it("does not expose setup failures", async () => {
    const handler = createChatHandler({ apiKey: "" });

    const response = await handler(chatRequest(conversation));

    expect(response.status).toBe(500);

    await expect(response.text()).resolves.toBe(FAILURE);
  });

  it("replaces provider failures with a generic RUN_ERROR", async () => {
    const secret = "provider-secret-should-not-leak";

    const sources = [
      () =>
        stream(
          started,
          { type: EventType.RUN_ERROR, timestamp: 3, message: secret },
          finished
        ),
      async function* failingStream() {
        yield started;

        throw new Error(secret);
      },
    ];

    const responses = await Promise.all(
      sources.map(async (createStream) => {
        const handler = createChatHandler({ createStream });

        const response = await handler(
          chatRequest({ ...conversation, runId: "run-1" })
        );

        return await response.text();
      })
    );

    for (const body of responses) {
      expect(body).not.toContain(secret);

      expect(parseEvents(body)).toMatchObject([
        { type: "RUN_STARTED" },
        {
          type: "RUN_ERROR",
          message: FAILURE,
          metadata: { tanstack: { threadId: "thread-1", runId: "run-1" } },
        },
      ]);
    }
  });

  it.each(["response", "request"])(
    "aborts the provider stream when the %s is cancelled",
    async (source) => {
      const requestController = new AbortController();
      /** @type {AbortSignal[]} */
      const signals = [];
      let streamClosed = false;

      const handler = createChatHandler({
        createStream: async function* createStream({ abortController }) {
          signals.push(abortController.signal);

          try {
            yield started;

            if (!abortController.signal.aborted) {
              await once(abortController.signal, "abort");
            }

            yield finished;
          } finally {
            streamClosed = true;
          }
        },
      });

      const response = await handler(
        chatRequest(conversation, requestController.signal)
      );

      assert.ok(response.body);

      const reader = response.body.getReader();

      await reader.read();

      if (source === "request") {
        requestController.abort("client disconnected");
      } else {
        await reader.cancel();
      }

      await expect(reader.read()).resolves.toMatchObject({ done: true });

      expect(signals).toMatchObject([{ aborted: true }]);
      expect(streamClosed).toBeTruthy();
    }
  );

  it.each([0, -1, 65_536, "not-a-port", 1.5])(
    "rejects invalid backend port %s",
    (port) => {
      expect(() => startServer({ port })).toThrow(
        "BACKEND_PORT must be an integer from 1 to 65535."
      );
    }
  );
});
