import { serve } from "srvx";

export const DEFAULT_PORT = 3000;

/**
 * @typedef {{ fetch: (request: Request) => Promise<unknown> }} Application
 */

/**
 * @param {Application} application - Application exposing a fetch handler.
 * @returns {(request: Request) => Promise<Response>} A fetch handler that rejects non-Response results.
 */
export const createFetchHandler = (application) => async (request) => {
  const response = await application.fetch(request);

  if (!(response instanceof Response)) {
    throw new TypeError("Server handler returned a non-Response value");
  }

  return response;
};

/**
 * @param {string | undefined} value - Port value from the environment.
 * @param {number} fallback - Port to use when the value is absent.
 * @returns {number} The parsed port number.
 */
export const resolvePort = (value, fallback) => {
  if (value === undefined || value === "") {
    return fallback;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError(`Invalid port: ${value}`);
  }

  return port;
};

/**
 * @param {{ application?: Application, environment?: Record<string, string | undefined>, port?: number, manual?: boolean }} [options] - Startup options.
 * @returns {Promise<import("srvx").Server>} The started server.
 */
export const start = async ({
  application,
  environment = process.env,
  port = DEFAULT_PORT,
  manual = false,
} = {}) => {
  let app = application;

  if (app === undefined) {
    const serverModule = await import("./dist/server/server.js");

    app = serverModule.default;
  }

  return serve({
    fetch: createFetchHandler(app),
    port: resolvePort(environment.PORT, port),
    manual,
  });
};

export const launcherFilename = import.meta.filename;

export const entryPointServer =
  process.argv[1] === launcherFilename ? await start() : undefined;
