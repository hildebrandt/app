import { Avatar, AvatarFallback } from "@ui-sdk/react/avatar";
import { Field } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import { Check } from "lucide-react";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  KindCheckbox,
  KindCheckboxIndicator,
} from "../components/ui/internal/checkbox";
import styles from "../styles/kind-app.module.css";

import { Icon } from "./-agent-icon";
import { createDraftTools, type DraftTools } from "./-agent-tools";
import {
  handleBridgeMessage,
  registerDraftWebMcp,
  resolveBridgeUrl,
} from "./-agent-transports";

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
  failed:
    "Bridge connection closed. Paste the bridge URL and connect again. If the process stopped, start a new one.",
  idle: "Bridge disconnected",
  invalid: "Enter the loopback URL from the bridge process.",
};

export const AgentConnections = ({
  control,
  draft,
  hydrated,
  tools,
}: AgentConnectionsProps) => {
  const grant = useRef(false);
  const socket = useRef<WebSocket | null>(null);
  const [granted, setGranted] = useState(false);
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
      isGranted: () => grant.current,
      setGrant: (nextGranted) => {
        grant.current = nextGranted;
        setGranted(nextGranted);
      },
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
        void handleBridgeMessage(connection, activeTools, message.data).catch(
          () => connection.close()
        );
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

  const hasConnection =
    bridgeStatus === "connected" || bridgeStatus === "connecting";

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Max Mustermann, agent connections"
        className={styles.profile}
        disabled={!hydrated}
      >
        <Avatar aria-hidden="true" className={styles.avatar}>
          <AvatarFallback>MM</AvatarFallback>
        </Avatar>
        <span className={styles.profileText}>
          <span className={styles.profileName}>Max Mustermann</span>
        </span>
        <Icon
          className={styles.profileChevron}
          name="chevron-down"
          size={14}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={styles.connections}
        side="top"
        sideOffset={8}
      >
        <PopoverTitle className={styles.connectionsHeading}>
          Agent connections
        </PopoverTitle>
        <div className={styles.connectionBody}>
          <label className={styles.connectionGrant}>
            <KindCheckbox
              checked={granted}
              data-agent-hidden=""
              disabled={!hydrated}
              onCheckedChange={(next) => {
                const checked = next === true;
                grant.current = checked;
                setGranted(checked);
                if (!checked) {
                  tools.current?.cancelProtected();
                }
              }}
            >
              <KindCheckboxIndicator aria-hidden="true">
                <Check aria-hidden="true" />
              </KindCheckboxIndicator>
            </KindCheckbox>
            Allow agents to edit the draft
          </label>
          <form className={styles.bridgeForm} onSubmit={connectBridge}>
            <Field name="bridgeUrl">
              <label className={styles.fieldLabel} htmlFor="agent-bridge-url">
                Bridge URL
              </label>
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
              <button
                className={styles.bridgeButton}
                data-kind-button="secondary"
                onClick={disconnectBridge}
                type="button"
              >
                Disconnect bridge
              </button>
            ) : (
              <button
                className={styles.bridgeButton}
                data-kind-button="primary"
                disabled={!hydrated}
                type="submit"
              >
                Connect bridge
              </button>
            )}
          </form>
          <p aria-live="polite" className={styles.connectionStatus}>
            {bridgeStatusText[bridgeStatus]}
          </p>
          <p aria-live="polite" className={styles.connectionStatus}>
            {webMcpStatus}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
};
