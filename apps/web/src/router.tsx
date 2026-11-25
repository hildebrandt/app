import "@ui-sdk/core/web.css";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

/**
 * Creates the application router.
 *
 * @returns The configured TanStack Router instance.
 */
export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
    trailingSlash: "never",
  });
