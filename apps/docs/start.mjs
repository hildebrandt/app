import { serve } from "srvx";
import app from "./dist/server/server.js";

serve({ fetch: (request) => app.fetch(request), port: process.env.PORT ?? 3001 });
