import { composerPrimitive, messagePrimitive } from "@kind-ui/agent-ui/core";
import { generateMessageId } from "@tanstack/ai-react";
import { useHydrated } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";
import { Button } from "@ui-sdk/react/button";
import { Field } from "@ui-sdk/react/field";
import { createParts } from "@ui-sdk/react/primitive";
import { Textarea } from "@ui-sdk/react/textarea";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  NoticeActions,
  NoticeDescription,
  NoticeRoot,
  NoticeTitle,
} from "../components/ui/notice";
import { Status } from "../components/ui/status";
import { Suggestion, SuggestionChip } from "../components/ui/suggestion";
import styles from "../styles/kind-app.module.css";

import { AgentConnections } from "./-agent-connections";
import { Icon, type IconName } from "./-agent-icon";
import type { DraftTools } from "./-agent-tools";
import { useAgentChat } from "./-use-agent-chat";

const messageParts = createParts(messagePrimitive, {
  root: "li",
  content: "p",
});
const composerParts = createParts(composerPrimitive, {
  root: "form",
  input: "div",
  "trigger-menu": "div",
  attachments: "div",
  submit: "button",
  stop: "button",
  restored: "div",
  discard: "button",
});

const NAV_ITEMS = [
  { icon: "inbox", label: "Inbox" },
  { icon: "document", label: "Documents" },
  { icon: "agent", label: "Agent" },
] satisfies readonly { icon: IconName; label: string }[];

const EXAMPLES = [
  {
    title: "Create a new project",
    description: "Turn an idea into a well-scoped project",
    icon: "cube",
  },
  {
    title: "Research a topic",
    description: "Research a topic across the issue backlog",
    icon: "search",
  },
  {
    title: "Set up new team",
    description: "Create a team that matches how your organization works",
    icon: "users",
  },
] satisfies readonly {
  title: string;
  description: string;
  icon: IconName;
}[];

const DRAFT_OUTCOMES = {
  changed: "Draft changed.",
  unchanged: "The draft was already set to the proposed text.",
  denied: "Draft edit denied.",
  cancelled: "Draft edit cancelled.",
  unavailable: "Draft edit unavailable. Check the draft and the edit grant.",
  unknown: "The draft edit outcome is unknown. Inspect the draft before trying again.",
};

const OUTCOME_STATUS = {
  changed: "complete",
  unchanged: "complete",
  denied: "cancelled",
  cancelled: "cancelled",
  unavailable: "error",
  unknown: "error",
} as const;

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

const subscribeToSystemTheme = (onChange: () => void) => {
  const query = window.matchMedia?.(DARK_MODE_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

export const AgentWorkspace = () => {
  const hydrated = useHydrated();
  const [threadId] = useState(() => generateMessageId());
  const [draft, setDraft] = useState("");
  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const [showExamples, setShowExamples] = useState(true);
  const [colorMode, setColorMode] = useState<"light" | "dark">();
  const systemIsDark = useSyncExternalStore(
    subscribeToSystemTheme,
    () => window.matchMedia?.(DARK_MODE_QUERY).matches ?? false,
    () => false
  );
  const isDark = colorMode === undefined ? systemIsDark : colorMode === "dark";
  const nextColorMode = isDark ? "light" : "dark";
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentDraft = useRef("");
  const draftTools = useRef<DraftTools | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const denyRef = useRef<HTMLButtonElement>(null);
  const chat = useAgentChat(threadId, draftTools);
  const { approval, actionResult, errorMessage, messages } = chat;
  const canSend = hydrated && !chat.busy && draft.trim() !== "";

  const chatMessages = messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    const text = message.parts
      .map((part) => (part.type === "text" ? part.content : ""))
      .join("");

    if (text === "") {
      return [];
    }

    return [{ id: message.id, role: message.role, text }];
  });

  useEffect(() => {
    const content = contentRef.current;
    if (content !== null && messages.length > 0) {
      content.scrollTop = content.scrollHeight;
    }
  }, [chat.busy, messages]);

  const updateDraft = (value: string, source?: string) => {
    if (value !== currentDraft.current && source !== "agent") {
      draftTools.current?.resetUndo();
    }
    currentDraft.current = value;
    setDraft(value);
  };

  const focusComposer = () => {
    inputRef.current?.focus();
  };

  const selectExample = (description: string) => {
    updateDraft(description);
    focusComposer();
  };

  const submitDraft = () => {
    if (!canSend) {
      return false;
    }
    const submitted = chat.submit(draft.trim());
    if (submitted) {
      updateDraft("");
    }
    return submitted;
  };


  const stopResponse = () => {
    chat.stopResponse();
    focusComposer();
  };

  const retryResponse = () => {
    if (chat.retry?.()) {
      focusComposer();
    }
  };

  const dismissExamples = () => {
    setShowExamples(false);
    focusComposer();
  };

  const dismissAnnouncement = () => {
    setShowAnnouncement(false);
    focusComposer();
  };

  return (
    <div className={styles.shell} data-color-mode={colorMode}>
      <aside className={styles.sidebar}>
        <nav aria-label="Workspace" className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const isCurrent = item.label === "Agent";
            return (
              <Button
                aria-current={isCurrent ? "page" : undefined}
                className={styles.navItem}
                disabled={!isCurrent || !hydrated}
                focusableWhenDisabled
                key={item.label}
                onClick={isCurrent ? focusComposer : undefined}
              >
                <Icon name={item.icon} size={16} />
                <span className={styles.navLabel}>{item.label}</span>
              </Button>
            );
          })}
        </nav>

        {showAnnouncement ? (
          <section aria-label="What's new" className={styles.announcement}>
            <NoticeRoot className={styles.notice} label="What's new">
              <NoticeTitle />
              <NoticeDescription>
                A new feature will be explained here
              </NoticeDescription>
              <NoticeActions>
                <Button
                  aria-label="Dismiss announcement"
                  className={styles.noticeDismiss}
                  disabled={!hydrated}
                  onClick={dismissAnnouncement}
                >
                  <Icon name="close" size={13} />
                </Button>
              </NoticeActions>
            </NoticeRoot>
          </section>
        ) : null}

        <AgentConnections
          control={inputRef}
          draft={currentDraft}
          hydrated={hydrated}
          tools={draftTools}
        />
      </aside>

      <main className={styles.mainColumn}>
        <section aria-label="Agent workspace" className={styles.workspace}>
          <header className={styles.header}>
            <span className={styles.headerTitle}>
              <span className={styles.headerLabel}>New chat</span>
              <Icon
                className={styles.headerChevron}
                name="chevron-down"
                size={14}
              />
            </span>
          </header>

          <div className={styles.content} ref={contentRef}>
            <div
              className={styles.starter}
              data-has-messages={chatMessages.length > 0}
            >
              {chatMessages.length > 0 ? (
                <ol aria-label="Chat messages" className={styles.transcript}>
                  {chatMessages.map((message) => (
                    <messageParts.Root
                      className={styles.message}
                      key={message.id}
                      messageRole={message.role}
                      render={<li role="listitem" />}
                      status="complete"
                      text={message.text}
                    >
                      <span className={styles.messageAuthor}>
                        {message.role === "user" ? "You" : "Agent"}
                      </span>
                      <messageParts.Content className={styles.messageText}>
                        {message.text}
                      </messageParts.Content>
                    </messageParts.Root>
                  ))}
                </ol>
              ) : null}

              <div className={styles.composerDock}>
                <composerParts.Root
                  agentConfirm={false}
                  aria-busy={chat.busy}
                  aria-label="Start a new chat"
                  className={styles.composer}
                  onSubmit={submitDraft}
                  value={{ text: draft, tokens: [], attachments: [] }}
                >
                  <Field className={styles.promptField} name="prompt">
                    <Textarea
                      aria-label="Ask Agent"
                      className={styles.textarea}
                      onValueChange={(value, { source }) =>
                        updateDraft(value, source)
                      }
                      placeholder="Ask anything"
                      readOnly={!hydrated}
                      ref={inputRef}
                      rows={2}
                      submitShortcut="enter"
                      value={draft}
                    />
                  </Field>

                  <div className={styles.composerActions}>
                    <span aria-hidden="true" className={styles.composerHint}>
                      <Icon name="plus" size={15} />
                    </span>
                    {chat.responding && !approval ? (
                      <Button
                        className={styles.stopButton}
                        data-kind-button="secondary"
                        onClick={stopResponse}
                      >
                        Stop
                      </Button>
                    ) : null}
                    <composerParts.Submit
                      aria-disabled={!canSend}
                      aria-label="Submit prompt"
                      className={styles.submitButton}
                      data-agent-confirm="Sends the message as you"
                    >
                      <Icon name="arrow-up" size={16} />
                    </composerParts.Submit>
                  </div>
                </composerParts.Root>

                {errorMessage ? (
                  <NoticeRoot
                    className={`${styles.notice} ${styles.errorNotice}`}
                    label="Chat error"
                    variant="error"
                  >
                    <NoticeTitle />
                    <NoticeDescription>
                      <p role="alert">{errorMessage}</p>
                    </NoticeDescription>
                    {chat.retry ? (
                      <NoticeActions className={styles.errorActions}>
                        <Button
                          className={styles.retryButton}
                          data-kind-button="secondary"
                          onClick={retryResponse}
                        >
                          Retry
                        </Button>
                      </NoticeActions>
                    ) : null}
                  </NoticeRoot>
                ) : null}

                {actionResult ? (
                  <p className={styles.draftOutcome} role="status">
                    <Status
                      label={DRAFT_OUTCOMES[actionResult.outcome]}
                      status={OUTCOME_STATUS[actionResult.outcome]}
                    />
                  </p>
                ) : null}
              </div>

              {showExamples && chatMessages.length === 0 ? (
                <section
                  aria-labelledby="examples-title"
                  className={styles.examples}
                >
                  <div className={styles.examplesHeader}>
                    <p className={styles.examplesTitle} id="examples-title">
                      Get started with some examples
                    </p>
                    <Button
                      aria-label="Dismiss examples"
                      className={styles.examplesDismiss}
                      disabled={!hydrated}
                      onClick={dismissExamples}
                    >
                      <Icon name="close" size={14} />
                    </Button>
                  </div>
                  <Suggestion
                    className={styles.suggestions}
                    label="Example prompts"
                    layout="wrap"
                    onPick={(id) => {
                      const example = EXAMPLES.find(
                        (item) => item.title === id
                      );
                      if (example !== undefined) {
                        selectExample(example.description);
                      }
                    }}
                    suggestions={EXAMPLES.map((example) => ({
                      id: example.title,
                      label: example.title,
                      description: example.description,
                    }))}
                  >
                    {EXAMPLES.map((example) => (
                      <SuggestionChip
                        className={styles.suggestionCard}
                        disabled={!hydrated}
                        key={example.title}
                        value={example.title}
                      >
                        <span
                          aria-hidden="true"
                          className={styles.suggestionIcon}
                        >
                          <Icon name={example.icon} size={16} />
                        </span>
                        <span className={styles.suggestionText}>
                          <span
                            className={styles.suggestionLabel}
                            data-suggestion-label=""
                          >
                            {example.title}
                          </span>
                          <span
                            className={styles.suggestionDescription}
                            data-suggestion-description=""
                          >
                            {example.description}
                          </span>
                        </span>
                      </SuggestionChip>
                    ))}
                  </Suggestion>
                </section>
              ) : null}
            </div>
          </div>
        </section>

        <footer className={styles.statusBar}>
          <span className={styles.statusMessage} role="status">
            {chat.responding || chat.stopped ? (
              <Status
                label={
                  chat.responding ? "Agent is responding" : "Response stopped"
                }
                status={chat.responding ? "running" : "cancelled"}
              />
            ) : null}
          </span>
          <Button
            aria-label={`Switch to ${nextColorMode} mode`}
            className={styles.themeButton}
            disabled={!hydrated}
            onClick={() => setColorMode(nextColorMode)}
            type="button"
          >
            <Icon name={isDark ? "sun" : "moon"} size={14} />
          </Button>
          <span className={styles.statusLabel}>
            <Icon name="agent" size={14} />
            Agent
          </span>
          <span aria-hidden="true" className={styles.statusClock}>
            <Icon name="clock" size={14} />
          </span>
        </footer>
      </main>

      <AlertDialog
        open={approval !== null}
        onOpenChange={(open) => {
          if (!open) {
            approval?.answer(false);
          }
        }}
      >
        <AlertDialogBackdrop className={styles.approvalBackdrop} />
        <AlertDialogContent
          className={styles.approvalDialog}
          finalFocus={() => inputRef.current}
          initialFocus={() => denyRef.current}
        >
          <AlertDialogTitle>Approve draft edit?</AlertDialogTitle>
          <AlertDialogDescription>
            The agent wants to replace the current draft without sending it.
          </AlertDialogDescription>
          <dl className={styles.approvalValues}>
            <div>
              <dt>Current draft</dt>
              <dd>{approval?.previous || "(empty)"}</dd>
            </div>
            <div>
              <dt>Proposed draft</dt>
              <dd>{approval?.value || "(empty)"}</dd>
            </div>
          </dl>
          <div className={styles.chatFeedback}>
            <button data-kind-button="secondary" onClick={stopResponse} type="button">
              Stop
            </button>
            <button
              data-kind-button="secondary"
              onClick={() => approval?.answer(false)}
              ref={denyRef}
              type="button"
            >
              Deny
            </button>
            <button
              data-kind-button="danger-ghost"
              onClick={() => draftTools.current?.revokeGrant()}
              type="button"
            >
              Revoke draft access
            </button>
            <button
              data-kind-button="primary"
              onClick={() => approval?.answer(true)}
              type="button"
            >
              Approve
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
