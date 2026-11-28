import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";

import {
  NoticeDescription,
  NoticeRoot,
  NoticeTitle,
} from "../components/ui/notice";
import styles from "../styles/kind-app.module.css";
import appCss from "../styles/globals.css?url";

const RootDocument = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

const NotFound = () => (
  <>
    <meta name="robots" content="noindex" />
    <main className={styles.notFound}>
      <div className={styles.notFoundPanel}>
        <p className={styles.notFoundCode}>Error 404</p>
        <h1 className={styles.notFoundTitle}>404</h1>
        <h2 className={styles.notFoundHeading}>This page could not be found.</h2>
        <NoticeRoot
          className={`${styles.notice} ${styles.notFoundNotice}`}
          label="Page not found"
        >
          <NoticeTitle />
          <NoticeDescription>
            The page you requested does not exist.
          </NoticeDescription>
        </NoticeRoot>
      </div>
    </main>
  </>
);

export const Route = createRootRoute({
  head: () => ({
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
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
});
