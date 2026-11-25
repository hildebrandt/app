import { describe, expect, it } from "vite-plus/test";

import { setHeader } from "./server";

describe("setHeader response handling", () => {
  it("preserves the response through the immutable fallback", () => {
    const response = Response.redirect("https://example.com");

    expect(() => {
      response.headers.set("x-test", "value");
    }).toThrow(/immutable/u);

    const result = setHeader(response, "cache-control", "private");

    expect(result).not.toBe(response);
    expect(result.headers.get("cache-control")).toBe("private");
    expect(result.status).toBe(response.status);
    expect(result.statusText).toBe(response.statusText);
  });
});
