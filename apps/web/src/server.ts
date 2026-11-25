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

function setHeader(response: Response, name: string, value: string) {
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
}

async function serveStatic(request: Request) {
  if (!staticHandler) return null;

  let nextCalled = false;
  const response = await staticHandler(request, () => {
    nextCalled = true;
    return new Response(null);
  });

  if (nextCalled) return null;

  const { pathname } = new URL(request.url);
  setHeader(
    response,
    "cache-control",
    pathname === "/favicon.ico"
      ? "public, max-age=0, must-revalidate"
      : "public, max-age=0",
  );
  if (pathname === "/favicon.ico") {
    setHeader(response, "content-type", "image/x-icon");
  }
  return response;
}

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      const location = `${url.pathname.replace(/\/+$/, "")}${url.search}`;
      return new Response(null, {
        status: 308,
        headers: { location },
      });
    }

    const staticResponse = await serveStatic(request);
    if (staticResponse) return staticResponse;

    const response = await startHandler(request);
    return setHeader(
      response,
      "cache-control",
      response.status === 404 && url.pathname !== "/_not-found"
        ? "private, no-cache, no-store, max-age=0, must-revalidate"
        : "s-maxage=31536000",
    );
  },
};
