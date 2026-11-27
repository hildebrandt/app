import { Button } from "@ui-sdk/react/button";
import { Field } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";

import styles from "../styles/agent-workspace.module.css";

import { createDraftTools, type DraftTools } from "./-agent-tools";
import { handleBridgeMessage, registerDraftWebMcp, resolveBridgeUrl } from "./-agent-transports";

type AgentConnectionsProps = {
  control: RefObject<HTMLTextAreaElement | null>;
  draft: RefObject<string>;
  hydrated: boolean;
  tools: RefObject<DraftTools | null>;
};

type BridgeStatus = "idle" | "connecting" | "connected" | "failed" | "invalid";
const bridgeStatusText: Record<BridgeStatus, string> = {
  connected: "Bridge connected",
  connecting: "Connecting bridge",
  failed: "Bridge connection closed. Paste the bridge URL and connect again. If the process stopped, start a new one.",
  idle: "Bridge disconnected",
  invalid: "Enter the loopback URL from the bridge process.",
};

export const AgentConnections = ({ control, draft, hydrated, tools }: AgentConnectionsProps) => {
  const grant = useRef<HTMLInputElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>("idle");
  const [webMcpStatus, setWebMcpStatus] = useState("WebMCP unavailable");

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const controller = new AbortController();
    const activeTools = createDraftTools({
      getControl: () => control.current,
      getDraft: () => draft.current,
      isGranted: () => grant.current?.checked === true,
    });
    tools.current = activeTools;

    void registerDraftWebMcp(activeTools, controller.signal).then(
      (registered) => {
        if (registered && !controller.signal.aborted) {
          setWebMcpStatus("WebMCP ready");
        }
      },
      () => {
        if (!controller.signal.aborted) {
          controller.abort();
          setWebMcpStatus("WebMCP registration failed");
        }
      },
    );

    return () => {
      controller.abort();
      activeTools.dispose();
      tools.current = null;
      const openSocket = socket.current;
      socket.current = null;
      openSocket?.close();
    };
  }, [control, draft, hydrated, tools]);

  const connectBridge = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const activeTools = tools.current;
    if (!activeTools || socket.current) {
      return;
    }
    const form = event.currentTarget;
    const url = resolveBridgeUrl(new FormData(form).get("bridgeUrl"));
    if (!url) {
      setBridgeStatus("invalid");
      return;
    }
    const connection = new WebSocket(url);
    socket.current = connection;
    setBridgeStatus("connecting");
    connection.addEventListener("open", () => {
      if (socket.current === connection) {
        form.reset();
        setBridgeStatus("connected");
      }
    });
    connection.addEventListener("message", (message: MessageEvent<unknown>) => {
      if (socket.current === connection) {
        void handleBridgeMessage(connection, activeTools, message.data).catch(() => connection.close());
      }
    });
    connection.addEventListener("close", () => {
      if (socket.current === connection) {
        socket.current = null;
        setBridgeStatus("failed");
      }
    });
  };

  const disconnectBridge = () => {
    const connection = socket.current;
    socket.current = null;
    connection?.close();
    setBridgeStatus("idle");
  };

  const hasConnection = bridgeStatus === "connected" || bridgeStatus === "connecting";

  return (
    <details className={styles.connections}>
      <summary>Agent connections</summary>
      <label className={styles.connectionGrant}>
        <input autoComplete="off" disabled={!hydrated} ref={grant} type="checkbox" />
        Allow agents to edit the draft
      </label>
      <form className={styles.bridgeForm} onSubmit={connectBridge}>
        <Field name="bridgeUrl">
          <label htmlFor="agent-bridge-url">Bridge URL</label>
          <Input
            autoComplete="off"
            className={styles.bridgeInput}
            disabled={!hydrated || hasConnection}
            id="agent-bridge-url"
            name="bridgeUrl"
            spellCheck={false}
          />
        </Field>
        {hasConnection ? (
          <Button className={styles.bridgeButton} onClick={disconnectBridge} type="button">
            Disconnect bridge
          </Button>
        ) : (
          <Button className={styles.bridgeButton} disabled={!hydrated} type="submit">
            Connect bridge
          </Button>
        )}
      </form>
      <p aria-live="polite">{bridgeStatusText[bridgeStatus]}</p>
      <p aria-live="polite">{webMcpStatus}</p>
    </details>
  );
};
