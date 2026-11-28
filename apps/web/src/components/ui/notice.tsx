"use client";

import { noticePrimitive } from "@kind-ui/agent-ui/core";
import { createParts, type Parts } from "@ui-sdk/react/primitive";
import type { ComponentProps } from "react";

const parts: Parts<typeof noticePrimitive, {
  root: "div";
  icon: "span";
  title: "p";
  description: "div";
  actions: "div";
  dismiss: "button";
}> = createParts(noticePrimitive, {
  root: "div",
  icon: "span",
  title: "p",
  description: "div",
  actions: "div",
  dismiss: "button",
});

/** The bare root, for arranging the parts yourself. */
export function NoticeRoot(props: ComponentProps<typeof parts.Root>) {
  return <parts.Root {...props} />;
}

export function NoticeDescription(props: ComponentProps<typeof parts.Description>) {
  return <parts.Description {...props} />;
}

export function NoticeActions(props: ComponentProps<typeof parts.Actions>) {
  return <parts.Actions {...props} />;
}

export type NoticeTitleProps = ComponentProps<typeof parts.Title>;

/** The `label`, unless you pass children. Rendered only with a `label`. */
export function NoticeTitle({ children = ({ label }) => label, ...props }: NoticeTitleProps) {
  return <parts.Title {...props}>{children}</parts.Title>;
}
