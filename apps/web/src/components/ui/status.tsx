"use client";

import type { StepStatus } from "@kind-ui/agent-ui";
import { type StatusState, statusPrimitive } from "@kind-ui/agent-ui/core";
import { createParts, type Parts } from "@ui-sdk/react/primitive";
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CircleX,
} from "lucide-react";
import type { ComponentProps, ReactElement } from "react";

import { LoaderCircleIcon } from "../icons/loader-circle";

import styles from "./status.module.css";

const parts: Parts<
  typeof statusPrimitive,
  { root: "span"; icon: "span"; label: "span" }
> = createParts(statusPrimitive, { root: "span", icon: "span", label: "span" });

function markFor(
  status: StepStatus,
  motion: StatusState["motion"]
): ReactElement {
  switch (status) {
    case "pending":
      return <CircleDashed size={16} />;
    case "running":
      return <LoaderCircleIcon size={16} spinning={motion === "auto"} />;
    case "awaiting-input":
      return <CircleDot size={16} />;
    case "complete":
      return <CircleCheck size={16} />;
    case "error":
      return <CircleX size={16} />;
    case "cancelled":
      return <CircleMinus size={16} />;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function StatusMark({
  motion,
  status,
}: {
  motion: StatusState["motion"];
  status: StepStatus;
}) {
  return (
    <span
      aria-hidden="true"
      className={styles.mark}
      data-slot="kind-status-icon"
      data-status={status}
    >
      {markFor(status, motion)}
    </span>
  );
}

export type StatusProps = ComponentProps<typeof parts.Root>;

/** A run status badge: its mark and label. Any `children` replace both. */
export function Status({ children, status, motion, ...props }: StatusProps) {
  return (
    <parts.Root {...props} motion={motion} status={status}>
      {children === undefined ? (
        <>
          <StatusMark motion={motion ?? "auto"} status={status ?? "pending"} />
          <StatusLabel />
        </>
      ) : (
        children
      )}
    </parts.Root>
  );
}

export type StatusLabelProps = ComponentProps<typeof parts.Label>;

/** The status's text: its `label`, unless you pass children. */
export function StatusLabel({
  children = ({ label }) => label,
  ...props
}: StatusLabelProps) {
  return <parts.Label {...props}>{children}</parts.Label>;
}
