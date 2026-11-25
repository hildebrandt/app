// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";

import { getRouter } from "./router";
import { routeTree } from "./routeTree.gen";

describe("router configuration", () => {
  it("configures scroll restoration, trailing slashes, and the route tree", () => {
    const router = getRouter();

    expect(router.routeTree).toBe(routeTree);
    expect(router.options.scrollRestoration).toBeTruthy();
    expect(router.options.trailingSlash).toBe("never");
  });
});
