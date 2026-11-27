import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import {
  signChatOwner,
  verifyChatOwner,
} from "../../../packages/agent-chat-contract/owner.mjs";

const staticDir = path.join(process.cwd(), "dist", "client");
const assetPath = path.join(staticDir, "assets", "mutation-test.js");
const faviconPath = path.join(staticDir, "favicon.ico");
const assetSource = "export const value = 1;";

let previousAsset: string | null = null;
let createdFavicon = false;

const loadServer = async (nodeEnv: string) => {
  vi.stubEnv("NODE_ENV", nodeEnv);

  vi.resetModules();

  return await import("./server");
};

const OWNER_SECRET = "0123456789abcdef0123456789abcdef";
const OWNER_ORIGIN = "http://127.0.0.1:3000";
const OWNER_COOKIE =
  /^agent_chat_owner=([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.[0-9a-f]{64}); Path=\/api\/chat; HttpOnly; SameSite=Strict$/u;
const STREAM_EVENT =
  'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Hi"}\n\n';

const ownerRequest = (headers: Record<string, string> = {}) =>
  new Request(`${OWNER_ORIGIN}/api/chat`, {
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

const sseBackend = (headers: Record<string, string> = {}) =>
  vi.fn((_url: URL, _options: RequestInit) =>
    Promise.resolve(
      new Response(STREAM_EVENT, {
        headers: { "content-type": "text/event-stream", ...headers },
      })
    )
  );

describe("server fetch routing", () => {
  beforeAll(async () => {
    await mkdir(path.dirname(assetPath), { recursive: true });

    previousAsset = await readFile(assetPath, "utf-8").catch(() => null);

    await writeFile(assetPath, assetSource);

    if (!existsSync(faviconPath)) {
      await writeFile(faviconPath, "icon");

      createdFavicon = true;
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();

    vi.resetModules();
  });

  afterAll(async () => {
    await (previousAsset === null
      ? rm(assetPath, { force: true })
      : writeFile(assetPath, previousAsset));

    if (createdFavicon) {
      await rm(faviconPath, { force: true });
    }
  });

  it("streams chat from the configured backend without forwarding browser credentials", async () => {
    const server = await loadServer("test");
    vi.stubEnv("CHAT_BACKEND_URL", "http://127.0.0.1:4100");
    const payload = { messages: [{ role: "user", content: "Hello" }] };
    const event = 'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Hi"}\n\n';
    const backendFetch = vi.fn((_url: URL, _options: RequestInit) =>
      Promise.resolve(
        new Response(event, { headers: { "content-type": "text/event-stream" } })
      )
    );
    vi.stubGlobal("fetch", backendFetch);

    const response = await server.default.fetch(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify(payload),
        headers: {
          authorization: "Bearer browser-only",
          "content-type": "application/json",
          cookie: "session=browser-only",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe(event);

    expect(backendFetch).toHaveBeenCalledTimes(1);
    const [url, options] = backendFetch.mock.calls[0] ?? [];
    expect(url?.href).toBe("http://127.0.0.1:4100/api/chat");
    expect(options?.method).toBe("POST");
    const headers = new Headers(options?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
    await expect(new Response(options?.body).json()).resolves.toEqual(payload);
  });

  it("issues and forwards a signed owner for a loopback request with a matching origin", async () => {
    const server = await loadServer("test");
    vi.stubEnv("CHAT_BACKEND_URL", "http://127.0.0.1:4100");
    vi.stubEnv("CHAT_OWNER_SECRET", OWNER_SECRET);
    const backendFetch = sseBackend();
    vi.stubGlobal("fetch", backendFetch);
    const request = ownerRequest({
      cookie: "theme=dark",
      origin: OWNER_ORIGIN,
      "x-agent-chat-owner": "forged",
    });

    const response = await server.default.fetch(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(STREAM_EVENT);

    const token = OWNER_COOKIE.exec(
      response.headers.get("set-cookie") ?? ""
    )?.[1];
    expect(token).toBeDefined();
    expect(verifyChatOwner(token, OWNER_SECRET)).toBe(token?.split(".")[0]);

    const [, options] = backendFetch.mock.calls[0] ?? [];
    const headers = new Headers(options?.headers);
    expect(headers.get("x-agent-chat-owner")).toBe(token);
    expect(headers.has("cookie")).toBe(false);
    expect(options?.signal).toBe(request.signal);
  });

  it("reuses a valid owner cookie without setting a new one", async () => {
    const server = await loadServer("test");
    vi.stubEnv("CHAT_BACKEND_URL", "http://127.0.0.1:4100");
    vi.stubEnv("CHAT_OWNER_SECRET", OWNER_SECRET);
    const token = signChatOwner(randomUUID(), OWNER_SECRET);
    const backendFetch = sseBackend();
    vi.stubGlobal("fetch", backendFetch);

    const response = await server.default.fetch(
      ownerRequest({
        cookie: `agent_chat_owner=${token}`,
        origin: OWNER_ORIGIN,
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();

    const [, options] = backendFetch.mock.calls[0] ?? [];
    expect(new Headers(options?.headers).get("x-agent-chat-owner")).toBe(token);
  });

  it("replaces an owner cookie that fails verification", async () => {
    const server = await loadServer("test");
    vi.stubEnv("CHAT_BACKEND_URL", "http://127.0.0.1:4100");
    vi.stubEnv("CHAT_OWNER_SECRET", OWNER_SECRET);
    const forged = `${randomUUID()}.${"0".repeat(64)}`;
    const backendFetch = sseBackend();
    vi.stubGlobal("fetch", backendFetch);

    const response = await server.default.fetch(
      ownerRequest({
        cookie: `agent_chat_owner=${forged}`,
        origin: OWNER_ORIGIN,
      })
    );

    const token = OWNER_COOKIE.exec(
      response.headers.get("set-cookie") ?? ""
    )?.[1];
    expect(token).toBeDefined();
    expect(token).not.toBe(forged);
    expect(verifyChatOwner(token, OWNER_SECRET)).toBe(token?.split(".")[0]);

    const [, options] = backendFetch.mock.calls[0] ?? [];
    expect(new Headers(options?.headers).get("x-agent-chat-owner")).toBe(token);
  });

  it("keeps requests without an eligible loopback origin text-only", async () => {
    const server = await loadServer("test");
    vi.stubEnv("CHAT_BACKEND_URL", "http://127.0.0.1:4100");
    vi.stubEnv("CHAT_OWNER_SECRET", OWNER_SECRET);
    const requests = [
      ownerRequest(),
      ownerRequest({ origin: "http://example.com" }),
      new Request("http://example.com/api/chat", {
        body: JSON.stringify({ messages: [] }),
        headers: {
          "content-type": "application/json",
          origin: "http://example.com",
        },
        method: "POST",
      }),
    ];

    for (const request of requests) {
      const backendFetch = sseBackend();
      vi.stubGlobal("fetch", backendFetch);

      const response = await server.default.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      const [, options] = backendFetch.mock.calls[0] ?? [];
      expect(new Headers(options?.headers).has("x-agent-chat-owner")).toBe(
        false
      );
    }
  });

  it.for(["http://203.0.113.7:4100", "http://localhost:4100"])(
    "does not forward an owner to a backend without a loopback IP literal (%s)",
    async (backendUrl) => {
      const server = await loadServer("test");
      vi.stubEnv("CHAT_BACKEND_URL", backendUrl);
      vi.stubEnv("CHAT_OWNER_SECRET", OWNER_SECRET);
      const backendFetch = sseBackend();
      vi.stubGlobal("fetch", backendFetch);

      const response = await server.default.fetch(
        ownerRequest({ origin: OWNER_ORIGIN })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).not.toBeNull();
      const [, options] = backendFetch.mock.calls[0] ?? [];
      expect(new Headers(options?.headers).has("x-agent-chat-owner")).toBe(false);
    }
  );

  it("does not establish an owner when the configured secret is too short", async () => {
    const server = await loadServer("test");
    vi.stubEnv("CHAT_BACKEND_URL", "http://127.0.0.1:4100");
    vi.stubEnv("CHAT_OWNER_SECRET", "short");
    const backendFetch = sseBackend();
    vi.stubGlobal("fetch", backendFetch);

    const response = await server.default.fetch(
      ownerRequest({ origin: OWNER_ORIGIN })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    const [, options] = backendFetch.mock.calls[0] ?? [];
    expect(new Headers(options?.headers).has("x-agent-chat-owner")).toBe(false);
  });

  it("propagates a continuation conflict with sanitized copy and strips backend headers", async () => {
    const server = await loadServer("test");
    vi.stubEnv("CHAT_BACKEND_URL", "http://127.0.0.1:4100");
    vi.stubEnv("CHAT_OWNER_SECRET", OWNER_SECRET);
    const token = signChatOwner(randomUUID(), OWNER_SECRET);
    const backendFetch = vi.fn((_url: URL, _options: RequestInit) =>
      Promise.resolve(
        new Response("internal continuation detail", {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "set-cookie": "backend=1",
            "x-internal": "leak",
          },
          status: 409,
        })
      )
    );
    vi.stubGlobal("fetch", backendFetch);

    const response = await server.default.fetch(
      ownerRequest({
        cookie: `agent_chat_owner=${token}`,
        origin: OWNER_ORIGIN,
      })
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-internal")).toBeNull();
    await expect(response.text()).resolves.toBe(
      "The chat could not continue that action. Send a new message."
    );
  });

  it("strips backend headers except the SSE content type", async () => {
    const server = await loadServer("test");
    vi.stubEnv("CHAT_BACKEND_URL", "http://127.0.0.1:4100");
    const backendFetch = sseBackend({
      "cache-control": "public, max-age=60",
      "set-cookie": "backend=1",
      "x-internal": "leak",
    });
    vi.stubGlobal("fetch", backendFetch);

    const response = await server.default.fetch(ownerRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-internal")).toBeNull();
  });

  it("redirects a directory request and preserves the query string", async () => {
    const server = await loadServer("test");

    const response = await server.default.fetch(
      new Request("http://localhost///docs/guide///?page=2")
    );

    expect(response.status).toBe(308);

    expect(response.headers.get("location")).toBe("/docs/guide?page=2");

    expect(response.headers.get("refresh")).toBe("0;url=/docs/guide?page=2");

    await expect(response.text()).resolves.toBe("/docs/guide?page=2");
  });

  it("passes a root request to the start handler", async () => {
    const server = await loadServer("test");

    const response = await server.default.fetch(
      new Request("http://localhost/")
    );

    expect(response.status).toBe(200);

    await expect(response.text()).resolves.toContain("<!DOCTYPE html>");

    expect(response.headers.get("cache-control")).toBe("s-maxage=31536000");
  });

  it("uses private caching for a 404 outside /_not-found", async () => {
    const server = await loadServer("test");

    const response = await server.default.fetch(
      new Request("http://localhost/missing")
    );

    expect(response.status).toBe(404);

    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate"
    );
  });

  it("uses immutable caching for a 404 on /_not-found", async () => {
    const server = await loadServer("test");

    const response = await server.default.fetch(
      new Request("http://localhost/_not-found")
    );

    expect(response.status).toBe(404);

    expect(response.headers.get("cache-control")).toBe("s-maxage=31536000");
  });

  it("serves a static asset with the public cache policy", async () => {
    const server = await loadServer("production");

    const response = await server.default.fetch(
      new Request("http://localhost/assets/mutation-test.js")
    );

    expect(response.status).toBe(200);

    await expect(response.text()).resolves.toBe(assetSource);

    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8"
    );

    expect(response.headers.get("cache-control")).toBe("public, max-age=0");
  });

  it("sets the favicon cache and content type", async () => {
    const server = await loadServer("production");

    const response = await server.default.fetch(
      new Request("http://localhost/favicon.ico")
    );

    expect(response.status).toBe(200);

    expect(response.headers.get("content-type")).toBe("image/x-icon");

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
  });

  it("falls through when the static handler calls next", async () => {
    const server = await loadServer("production");

    const response = await server.default.fetch(
      new Request("http://localhost/assets/missing.js")
    );

    expect(response.status).toBe(404);

    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate"
    );
  });

  it("does not serve static assets outside production", async () => {
    const server = await loadServer("test");

    const response = await server.default.fetch(
      new Request("http://localhost/assets/mutation-test.js")
    );

    expect(response.status).toBe(404);

    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate"
    );
  });
});
