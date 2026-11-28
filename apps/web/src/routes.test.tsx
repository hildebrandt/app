// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Route } from "./routes/__root";
import { routeTree } from "./routeTree.gen";

import appCss from "./styles/globals.css?url";


interface HeadMetadata {
  links: {
    rel: string;
    href: string;
    as?: string;
    type?: string;
    crossOrigin?: string;
    sizes?: string;
  }[];
  meta: {
    charSet?: string;
    name?: string;
    content?: string;
    title?: string;
  }[];
}

const isHeadFunction = (value: unknown): value is () => HeadMetadata =>
  typeof value === "function";

describe("root route", () => {
  afterEach(cleanup);

  it("defines the document metadata", () => {
    if (!isHeadFunction(Route.options.head)) {
      throw new Error("Root route head is unavailable");
    }

    expect(Route.options.head()).toStrictEqual({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Agent" },
        { name: "description", content: "Start a chat with Agent." },
      ],
      links: [
        {
          rel: "preload",
          href: "/fonts/InterVariable.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        {
          rel: "preload",
          href: "/fonts/GeistMonoVariable.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        { rel: "stylesheet", href: appCss },
        {
          rel: "icon",
          href: "/favicon.ico?favicon.2vob68tjqpejf.ico",
          sizes: "256x256",
          type: "image/x-icon",
        },
      ],
    });
  });

  it("renders the not found page", () => {
    const NotFound = Route.options.notFoundComponent;

    if (!NotFound) {
      throw new Error("Not found component is unavailable");
    }

    const { container } = render(createElement(NotFound));
    const heading = screen.getByRole("heading", { level: 1 });
    const subheading = screen.getByRole("heading", { level: 2 });
    const robots = document.querySelector<HTMLMetaElement>(
      'meta[name="robots"]'
    );

    expect(container.querySelector("style")).toBeNull();
    expect(container.querySelector("main")).not.toBeNull();
    expect(
      screen.queryByRole("region", { name: "Agent workspace" })
    ).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Workspace" })
    ).toBeNull();
    expect(screen.getByText("404")).toBe(heading);
    expect(screen.getByText("This page could not be found.")).toBe(subheading);
    expect(robots?.content).toBe("noindex");
  });

  it("renders the full document with the router", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });

    await router.load();

    const html = renderToStaticMarkup(
      createElement(RouterProvider, { router })
    );

    expect({
      body: html.includes("<body>"),
      description: html.includes(
        '<meta name="description" content="Start a chat with Agent."/>'
      ),
      document: html.includes('<html lang="en"><head>'),
      home: html.includes('placeholder="Ask anything"'),
      title: html.includes("<title>Agent</title>"),
    }).toStrictEqual({
      body: true,
      description: true,
      document: true,
      home: true,
      title: true,
    });
  });
});
