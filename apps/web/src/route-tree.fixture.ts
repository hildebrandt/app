import { createRootRoute, createRoute } from "@tanstack/react-router";
import type { RootRouteOptions } from "@tanstack/react-router";

import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";

const isRootRouteOptions = (options: unknown): options is RootRouteOptions =>
  typeof options === "object" && options !== null;

if (!isRootRouteOptions(RootRoute.options)) {
  throw new Error("Root route options are unavailable");
}

const { head, notFoundComponent, shellComponent } = RootRoute.options;

const rootRoute = createRootRoute({
  head,
  notFoundComponent,
  shellComponent,
});

const indexRoute = createRoute({
  component: IndexRoute.options.component,
  getParentRoute: () => rootRoute,
  path: "/",
});

export const routeTree = rootRoute.addChildren([indexRoute]);
