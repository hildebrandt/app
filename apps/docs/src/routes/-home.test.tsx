// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Route } from "./index";

interface HeadLinks {
  links: {
    rel: string;
    as: string;
    href: string;
  }[];
}

const isHeadFunction = (value: unknown): value is () => HeadLinks =>
  typeof value === "function";

const Home = Route.options.component;

if (!Home) {
  throw new Error("Home route component is unavailable");
}

const attributeMap = (element: Element | null, names: string[]) =>
  Object.fromEntries(names.map((name) => [name, element?.getAttribute(name)]));

const renderHome = async () => {
  await act(async () => {
    render(createElement(Home));

    await Promise.resolve();
  });

  await screen.findAllByAltText("Turborepo logo");
};

describe("home route", () => {
  afterEach(cleanup);

  it("renders the page content and image priorities", async () => {
    await renderHome();

    const [lightImage, darkImage] = screen.getAllByAltText("Turborepo logo");

    expect({
      darkImage: attributeMap(darkImage ?? null, [
        "src",
        "class",
        "loading",
        "fetchpriority",
      ]),
      lightImage: attributeMap(lightImage ?? null, [
        "src",
        "class",
        "width",
        "height",
        "loading",
        "fetchpriority",
      ]),
    }).toStrictEqual({
      darkImage: {
        src: "turborepo-light.svg",
        class: "imgDark",
        loading: "eager",
        fetchpriority: "high",
      },
      lightImage: {
        src: "turborepo-dark.svg",
        class: "imgLight",
        width: "180",
        height: "38",
        loading: "eager",
        fetchpriority: "high",
      },
    });
  });

  it("renders the page copy, links, and footer", async () => {
    await renderHome();

    const deployLink = screen.getByRole("link", { name: /Deploy now/u });
    const docsLink = screen.getByRole("link", { name: "Read our docs" });
    const examplesLink = screen.getByRole("link", { name: /Examples/u });

    const turborepoLink = screen.getByRole("link", {
      name: /Go to turborepo.dev/u,
    });

    expect({
      code: screen.getByText("apps/docs/src/routes/index.tsx").tagName,
      copy: screen.getByText(/Get started by editing/u).textContent,
      deploy: attributeMap(deployLink, ["href", "target", "rel"]),
      docs: attributeMap(docsLink, ["href", "target"]),
      examples: attributeMap(examplesLink, ["href"]),
      globe: attributeMap(screen.getByAltText("Globe icon"), [
        "src",
        "aria-hidden",
      ]),
      turborepo: attributeMap(turborepoLink, ["href"]),
      window: attributeMap(screen.getByAltText("Window icon"), [
        "src",
        "width",
        "height",
        "aria-hidden",
      ]),
    }).toStrictEqual({
      code: "CODE",
      copy: "Get started by editing apps/docs/src/routes/index.tsx",
      deploy: {
        href: "https://vercel.com/new/clone?demo-description=Learn+to+implement+a+monorepo+with+a+two+Next.js+sites+that+has+installed+three+local+packages.&demo-image=%2F%2Fimages.ctfassets.net%2Fe5382hct74si%2F4K8ZISWAzJ8X1504ca0zmC%2F0b21a1c6246add355e55816278ef54bc%2FBasic.png&demo-title=Monorepo+with+Turborepo&demo-url=https%3A%2F%2Fexamples-basic-web.vercel.sh%2F&from=templates&project-name=Monorepo+with+Turborepo&repository-name=monorepo-turborepo&repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fturborepo%2Ftree%2Fmain%2Fexamples%2Fbasic&root-directory=apps%2Fdocs&skippable-integrations=1&teamSlug=vercel&utm_source=create-turbo",
        target: "_blank",
        rel: "noopener noreferrer",
      },
      docs: {
        href: "https://turborepo.dev/docs?utm_source",
        target: "_blank",
      },
      examples: {
        href: "https://vercel.com/templates?search=turborepo&utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app",
      },
      globe: {
        src: "/globe.svg",
        "aria-hidden": "true",
      },
      turborepo: {
        href: "https://turborepo.dev?utm_source=create-turbo",
      },
      window: {
        src: "/window.svg",
        width: "16",
        height: "16",
        "aria-hidden": "true",
      },
    });
  });

  it("renders the message after the button click", async () => {
    await renderHome();

    screen.getByText(/Get started by editing/u);

    expect(screen.queryByText("Hello from your docs app!")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show message" }));

    expect(screen.getByText("Hello from your docs app!").tagName).toBe(
      "OUTPUT"
    );
  });

  it("defines the preload links", () => {
    if (!isHeadFunction(Route.options.head)) {
      throw new Error("Home route head is unavailable");
    }

    expect(Route.options.head()).toStrictEqual({
      links: [
        { rel: "preload", as: "image", href: "/turborepo-dark.svg" },
        { rel: "preload", as: "image", href: "/turborepo-light.svg" },
      ],
    });
  });
});
