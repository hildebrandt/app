// @vitest-environment node
import type { Server } from "srvx";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_PORT,
  createFetchHandler,
  entryPointServer as importedEntryPointServer,
  launcherFilename,
  resolvePort,
  start,
} from "./start.mjs";

const application = {
  fetch: async () => {
    await Promise.resolve();

    return new Response("ok");
  },
};

const closeServer = async (server: Server) => {
  await server.close(true);
};

describe("launcher", () => {
  let entryPointServer: Server | undefined;

  afterAll(async () => {
    if (importedEntryPointServer !== undefined) {
      await closeServer(importedEntryPointServer);
    }

    if (entryPointServer !== undefined) {
      await closeServer(entryPointServer);
    }
  });

  it("does not start when imported", () => {
    expect(importedEntryPointServer).toBeUndefined();
  });

  it("rejects a non-Response handler result", async () => {
    const handler = createFetchHandler({
      fetch: async () => {
        await Promise.resolve();

        return "invalid";
      },
    });

    await expect(handler(new Request("http://localhost/"))).rejects.toThrow(
      /non-Response/u
    );
  });

  it("uses the default port", () => {
    expect(DEFAULT_PORT).toBe(3000);
    expect(resolvePort(undefined, DEFAULT_PORT)).toBe(DEFAULT_PORT);
    expect(resolvePort("", DEFAULT_PORT)).toBe(DEFAULT_PORT);
  });

  it("parses a configured port", () => {
    expect(resolvePort("4100", DEFAULT_PORT)).toBe(4100);
    expect(resolvePort("0", DEFAULT_PORT)).toBe(0);
    expect(resolvePort("65535", DEFAULT_PORT)).toBe(65_535);
  });

  it("rejects an invalid port", () => {
    expect(() => resolvePort("nope", DEFAULT_PORT)).toThrow(/Invalid port/u);
    expect(() => resolvePort("-1", DEFAULT_PORT)).toThrow(/Invalid port/u);
    expect(() => resolvePort("65536", DEFAULT_PORT)).toThrow(/Invalid port/u);
  });

  it("loads the built application when none is provided", async () => {
    const server = await start({ environment: {}, port: 0 });

    try {
      await server.ready();

      if (server.url === undefined) {
        throw new Error("Server URL is unavailable");
      }

      const response = await fetch(server.url);

      expect(response.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("serves requests after startup", async () => {
    const server = await start({ application, environment: {}, port: 0 });

    try {
      await server.ready();

      if (server.url === undefined) {
        throw new Error("Server URL is unavailable");
      }

      const response = await fetch(server.url);

      await expect(response.text()).resolves.toBe("ok");
    } finally {
      await closeServer(server);
    }
  });

  it("starts when executed as the entry point", async () => {
    const [, previousArgv] = process.argv;
    const { PORT: previousPort } = process.env;

    process.argv[1] = launcherFilename;

    process.env.PORT = "0";

    vi.resetModules();

    try {
      const launcher = await import("./start.mjs");

      ({ entryPointServer } = launcher);

      if (entryPointServer === undefined) {
        throw new Error("Entry point server did not start");
      }

      await entryPointServer.ready();

      if (entryPointServer.url === undefined) {
        throw new Error("Server URL is unavailable");
      }

      const response = await fetch(entryPointServer.url);

      expect(response.status).toBe(200);
    } finally {
      if (previousArgv === undefined) {
        process.argv.splice(1, 1);
      } else {
        process.argv[1] = previousArgv;
      }

      if (previousPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previousPort;
      }
    }
  });
});
