import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const webDir = path.join(repoRoot, "apps/web");
const backendEntry = path.join(repoRoot, "apps/backend/start.mjs");

process.env.NODE_ENV = "production";
process.env.HOST = "127.0.0.1";

/** @typedef {{ type: string, [key: string]: unknown }} ChatChunk */
/** @typedef {{ role: "user" | "assistant", content: string }} ChatMessage */
/** @typedef {{ type: "chunk", chunk: ChatChunk } | { type: "hold" } | { type: "end" } | { type: "throw", message?: string }} ScenarioStep */
/** @typedef {{ steps: ScenarioStep[] }} Scenario */

let scenarios = [];
let runs = [];
let runSequence = 0;
let webUrl = null;

function loopbackUrl(raw) {
  const url = new URL(raw);
  url.hostname = "127.0.0.1";
  return url.href;
}

function createGate() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function snapshot() {
  return {
    webUrl,
    scenariosRemaining: scenarios.length,
    runs: runs.map((run) => ({
      index: run.index,
      threadId: run.threadId,
      runId: run.runId,
      messages: run.messages,
      aborted: run.aborted,
      abortReason: run.abortReason,
      status: run.status,
      terminal: run.terminal,
      holding: run.holding,
      released: run.released,
      lateAttempted: run.lateAttempted,
      ended: run.ended,
      error: run.error,
    })),
  };
}

/** @param {{ messages: ChatMessage[], threadId?: string, runId?: string, abortController?: AbortController }} input */
function createStream(input) {
  const scenario = scenarios.shift() ?? { steps: [] };
  const signal = input.abortController?.signal;
  const run = {
    index: runSequence,
    threadId: input.threadId ?? null,
    runId: input.runId ?? null,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    aborted: false,
    abortReason: null,
    status: "streaming",
    terminal: null,
    holding: false,
    released: false,
    gate: null,
    lateAttempted: false,
    ended: false,
    error: null,
  };
  runSequence += 1;
  runs.push(run);

  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        run.aborted = true;
        const reason = signal.reason;
        run.abortReason =
          reason === undefined || reason === null
            ? null
            : String(reason.message ?? reason);
        if (run.status === "streaming") {
          run.status = "aborted";
        }
      },
      { once: true },
    );
  }

  return (async function* stream() {
    try {
      for (const step of scenario.steps) {
        if (step.type === "chunk") {
          if (run.aborted) {
            run.lateAttempted = true;
          }
          if (step.chunk.type === "RUN_FINISHED") {
            run.terminal = "finished";
            run.status = "finished";
          } else if (step.chunk.type === "RUN_ERROR") {
            run.terminal = "error";
            run.status = "error";
          }
          yield step.chunk;
        } else if (step.type === "hold") {
          const gate = createGate();
          run.gate = gate;
          run.holding = true;
          await gate.promise;
          run.holding = false;
          run.gate = null;
          run.released = true;
        } else if (step.type === "end") {
          run.terminal = run.terminal ?? "eof";
          if (run.status === "streaming") {
            run.status = "eof";
          }
          return;
        } else if (step.type === "throw") {
          throw new Error(step.message ?? "scripted stream failure");
        } else {
          throw new Error(`unknown scenario step: ${String(step.type)}`);
        }
      }
      run.terminal = run.terminal ?? "eof";
      if (run.status === "streaming") {
        run.status = "eof";
      }
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      run.status = "threw";
      throw error;
    } finally {
      run.ended = true;
      run.holding = false;
      run.gate = null;
    }
  })();
}

function releaseGate(index) {
  const run = runs.find((candidate) => candidate.index === index);
  if (!run || !run.gate) {
    return false;
  }
  const { gate } = run;
  run.gate = null;
  gate.resolve();
  return true;
}

/** @param {import("node:http").IncomingMessage} request */
async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return body === "" ? {} : JSON.parse(body);
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  });
  response.end(body);
}

const controlServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/state") {
      sendJson(response, 200, snapshot());
      return;
    }
    if (request.method === "POST" && url.pathname === "/reset") {
      const body = await readJson(request);
      if (!Array.isArray(body.scenarios)) {
        sendJson(response, 400, { error: "scenarios must be an array" });
        return;
      }
      for (const run of runs) {
        run.gate?.resolve();
        run.gate = null;
      }
      scenarios = body.scenarios;
      runs = [];
      runSequence = 0;
      sendJson(response, 200, snapshot());
      return;
    }
    if (request.method === "POST" && url.pathname === "/release") {
      const body = await readJson(request);
      if (!Number.isInteger(body.run)) {
        sendJson(response, 400, { error: "run must be an integer" });
        return;
      }
      sendJson(response, 200, {
        released: releaseGate(body.run),
        state: snapshot(),
      });
      return;
    }
    sendJson(response, 404, { error: "not found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

async function listenControl() {
  await new Promise((resolve, reject) => {
    controlServer.once("error", reject);
    controlServer.listen(0, "127.0.0.1", resolve);
  });
  const address = controlServer.address();
  if (!address || typeof address === "string") {
    throw new Error("control server has no TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function main() {
  const webRequire = createRequire(
    pathToFileURL(path.join(webDir, "package.json")),
  );
  const srvx = await import(pathToFileURL(webRequire.resolve("srvx")).href);
  const { createChatHandler } = await import(pathToFileURL(backendEntry).href);

  const controlUrl = await listenControl();

  const backendServer = srvx.serve({
    fetch: createChatHandler({ createStream }),
    hostname: "127.0.0.1",
    port: 0,
    silent: true,
  });
  await backendServer.ready();
  process.env.CHAT_BACKEND_URL = loopbackUrl(backendServer.url);

  process.chdir(webDir);
  const { start } = await import(
    pathToFileURL(path.join(webDir, "start.mjs")).href
  );
  const webServer = await start({ environment: { PORT: "0" }, port: 0 });
  await webServer.ready();
  webUrl = loopbackUrl(webServer.url);

  console.log(JSON.stringify({ webUrl, controlUrl }));

  const shutdown = async () => {
    controlServer.closeAllConnections?.();
    await Promise.allSettled([
      webServer.close(true),
      backendServer.close(true),
    ]);
    controlServer.close();
  };

  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
