import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { staticMiddleware } from "srvx/static";

const startHandler = createStartHandler(defaultStreamHandler);

const staticHandler =
  process.env.NODE_ENV === "production"
    ? staticMiddleware({ dir: "dist/client", maxAge: 0 })
    : null;

/**
 * Sets a header on a response.
 *
 * @param response - Response to update.
 * @param name - Header name.
 * @param value - Header value.
 * @returns The same response when headers are mutable; otherwise a new response with the same status, status text, body, and headers plus the new header.
 */
export const setHeader = (response: Response, name: string, value: string) => {
  try {
    response.headers.set(name, value);

    return response;
  } catch {
    const headers = new Headers(response.headers);

    headers.set(name, value);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
};

const serveStatic = async (request: Request) => {
  if (!staticHandler) {
    return null;
  }

  let nextCalled = false;

  const response = await staticHandler(request, () => {
    nextCalled = true;

    return new Response(null);
  });

  if (nextCalled) {
    return null;
  }

  const { pathname } = new URL(request.url);

  setHeader(
    response,
    "cache-control",
    pathname === "/favicon.ico"
      ? "public, max-age=0, must-revalidate"
      : "public, max-age=0"
  );

  if (pathname === "/favicon.ico") {
    setHeader(response, "content-type", "image/x-icon");
  }

  return response;
};

const proxyChat = async (request: Request) => {
  const headers = { "cache-control": "no-store" };

  if (request.method !== "POST") {
    return new Response(null, {
      headers: { ...headers, allow: "POST" },
      status: 405,
    });
  }

  const contentType = request.headers.get("content-type")?.split(";")[0];
  if (!request.body || contentType?.trim().toLowerCase() !== "application/json") {
    return new Response(null, { headers, status: 415 });
  }

  const unavailable = () =>
    new Response("Chat is unavailable. Try again.", { headers, status: 502 });

  try {
    const target = new URL(
      "/api/chat",
      process.env.CHAT_BACKEND_URL ?? "http://127.0.0.1:3002"
    );
    const options = {
      body: request.body,
      duplex: "half",
      headers: { "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: request.signal,
    } as const;
    const response = await fetch(target, options);
    const streamType = response.headers.get("content-type");

    if (!response.ok || !streamType?.startsWith("text/event-stream")) {
      await response.body?.cancel();
      return unavailable();
    }

    return new Response(response.body, {
      headers: { ...headers, "content-type": streamType },
    });
  } catch {
    return unavailable();
  }
};

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      return await proxyChat(request);
    }

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      let path = url.pathname;

      while (path.endsWith("/")) {
        path = path.slice(0, -1);
      }

      while (path.startsWith("/")) {
        path = path.slice(1);
      }

      const destination = `/${path}${url.search}`;

      return new Response(new TextEncoder().encode(destination), {
        status: 308,
        headers: {
          location: destination,
          refresh: `0;url=${destination}`,
        },
      });
    }

    const staticResponse = await serveStatic(request);

    if (staticResponse) {
      return staticResponse;
    }

    const response = await startHandler(request);

    return setHeader(
      response,
      "cache-control",
      response.status === 404 && url.pathname !== "/_not-found"
        ? "private, no-cache, no-store, max-age=0, must-revalidate"
        : "s-maxage=31536000"
    );
  },
};
