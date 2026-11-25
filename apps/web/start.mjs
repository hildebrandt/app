import { serve } from "srvx";

import app from "./dist/server/server.js";

serve({
  fetch: async (request) => {
    /** @type {unknown} */
    const response = await app.fetch(request);

    if (!(response instanceof Response)) {
      throw new TypeError("Server handler returned a non-Response value");
    }

    return response;
  },
  port: process.env.PORT ?? 3000,
});
