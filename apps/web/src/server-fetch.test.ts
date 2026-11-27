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
