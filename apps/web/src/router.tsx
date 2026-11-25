import "@ui-sdk/core/web.css";
import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export const getRouter = () =>
  createRouter({
    routeTree,
    scrollRestoration: true,
    trailingSlash: "never",
  });
