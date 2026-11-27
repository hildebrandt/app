import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import process from "node:process";
import { WebSocket, WebSocketServer } from "ws";

const HOST = "127.0.0.1";
const MAX_MESSAGE_BYTES = 64_000;
const MAX_PENDING_REQUESTS = 32;
const USAGE = "Usage: node apps/web/scripts/agent-bridge.mjs <app-origin>";
const FORBIDDEN_RESPONSE =
  "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

const parseAppOrigin = (value) => {
  try {
    const origin = new URL(value);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.origin !== value
    ) {
      return null;
    }
    return origin;
  } catch {
    return null;
  }
};

const appOrigin = parseAppOrigin(process.argv[2]);

if (!appOrigin) {
  console.error(USAGE);
  process.exit(1);
}

const bridgePath = `/${randomBytes(16).toString("hex")}`;
const pendingIds = new Set();
let browser;
let shuttingDown = false;

const writeOutput = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const failPendingRequests = (error) => {
  for (const id of pendingIds) {
    writeOutput({ id, result: { error, ok: false } });
  }
  pendingIds.clear();
};

const isValidRequest = (request) => {
  if (request.method === "tools/list") {
    return true;
  }
  return (
    request.method === "tools/call" &&
    typeof request.name === "string" &&
    Object.hasOwn(request, "arguments")
  );
};

const handleRequestLine = (line) => {
  if (line.trim() === "") {
    return;
  }
  if (line.length > MAX_MESSAGE_BYTES) {
    writeOutput({ error: "invalid_request", type: "error" });
    return;
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    writeOutput({ error: "invalid_request", type: "error" });
    return;
  }
  if (
    typeof request !== "object" ||
    request === null ||
    Array.isArray(request) ||
    !Number.isSafeInteger(request.id)
  ) {
    writeOutput({ error: "invalid_request", type: "error" });
    return;
  }
  const { id } = request;
  if (pendingIds.has(id)) {
    writeOutput({ id, result: { error: "duplicate_request_id", ok: false } });
    return;
  }
  if (!isValidRequest(request)) {
    writeOutput({ id, result: { error: "invalid_request", ok: false } });
    return;
  }
  const connection = browser;
  if (connection?.readyState !== WebSocket.OPEN) {
    writeOutput({ id, result: { error: "bridge_disconnected", ok: false } });
    return;
  }
  if (pendingIds.size >= MAX_PENDING_REQUESTS) {
    writeOutput({ id, result: { error: "bridge_busy", ok: false } });
    return;
  }
  pendingIds.add(id);
  try {
    connection.send(line);
  } catch {
    pendingIds.delete(id);
    writeOutput({ id, result: { error: "bridge_disconnected", ok: false } });
  }
};

const handleBrowserReply = (connection, payload, isBinary) => {
  if (isBinary) {
    connection.close(1003, "unsupported data");
    return;
  }
  let reply;
  try {
    reply = JSON.parse(payload.toString());
  } catch {
    connection.close(1007, "invalid message");
    return;
  }
  if (
    typeof reply !== "object" ||
    reply === null ||
    Array.isArray(reply) ||
    !Object.hasOwn(reply, "result") ||
    !Number.isSafeInteger(reply.id) ||
    !pendingIds.delete(reply.id)
  ) {
    return;
  }
  writeOutput({ id: reply.id, result: reply.result });
};

const attachBrowser = (connection) => {
  browser = connection;
  writeOutput({ type: "connected" });
  connection.on("message", (payload, isBinary) => {
    handleBrowserReply(connection, payload, isBinary);
  });
  connection.on("error", () => {
    connection.terminate();
  });
  connection.on("close", () => {
    if (browser !== connection) {
      return;
    }
    browser = undefined;
    failPendingRequests("bridge_disconnected");
  });
};

const server = createServer((_request, response) => {
  response.writeHead(404).end();
});
const webSocketServer = new WebSocketServer({
  clientTracking: false,
  maxPayload: MAX_MESSAGE_BYTES,
  noServer: true,
  perMessageDeflate: false,
});

const shutdown = () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  browser?.terminate();
  server.close();
  server.closeAllConnections();
  webSocketServer.close();
};

const stop = () => {
  process.stdin.destroy();
  shutdown();
};

server.on("upgrade", (request, socket, head) => {
  if (
    browser ||
    request.url !== bridgePath ||
    request.headers.origin !== appOrigin.origin
  ) {
    socket.on("error", () => {
      socket.destroy();
    });
    socket.end(FORBIDDEN_RESPONSE);
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, attachBrowser);
});

server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
  stop();
});

webSocketServer.on("error", (error) => {
  console.error(error.message);
});

let inputBuffer = "";
let discardingInput = false;

const processInput = (chunk) => {
  inputBuffer += chunk;
  let newlineIndex = inputBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = inputBuffer.slice(0, newlineIndex);
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (discardingInput) {
      discardingInput = false;
    } else {
      handleRequestLine(line);
    }
    newlineIndex = inputBuffer.indexOf("\n");
  }
  if (inputBuffer.length > MAX_MESSAGE_BYTES) {
    inputBuffer = "";
    discardingInput = true;
    writeOutput({ error: "invalid_request", type: "error" });
  }
};

process.stdin.setEncoding("utf8");
process.stdin.on("data", processInput);
process.stdin.on("end", shutdown);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.stdin.on("error", stop);
process.stdout.on("error", stop);

server.listen(0, HOST, () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    process.exitCode = 1;
    stop();
    return;
  }
  writeOutput({
    type: "ready",
    url: `ws://${HOST}:${address.port}${bridgePath}`,
  });
});
