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
import { Textarea } from "@ui-sdk/react/textarea";
import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "../styles/agent-workspace.module.css";

import { AgentConnections } from "./-agent-connections";
import { Icon, type IconName } from "./-agent-icon";
import type { DraftTools } from "./-agent-tools";
import { useAgentChat } from "./-use-agent-chat";

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

export const AgentWorkspace = () => {
  const hydrated = useHydrated();
  const [threadId] = useState(() => generateMessageId());
  const [draft, setDraft] = useState("");
  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const [showExamples, setShowExamples] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentDraft = useRef("");
  const draftTools = useRef<DraftTools | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const chat = useAgentChat(threadId, draftTools);
  const { approval, actionResult, errorMessage, messages } = chat;
  const denyRef = useRef<HTMLButtonElement>(null);
  const canSend = hydrated && !chat.busy && draft.trim() !== "";
  const chatMessages = messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      return [];
    }

    const text = message.parts
      .map((part) => (part.type === "text" ? part.content : ""))
      .join("");

    return text === "" ? [] : [{ id: message.id, role: message.role, text }];
  });

  useEffect(() => {
    const content = contentRef.current;

    if (content) {
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

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSend) {
      return;
    }

    if (chat.submit(draft.trim())) {
      updateDraft("");
    }
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
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <nav aria-label="Workspace" className={styles.nav}>
          {NAV_ITEMS.map(({ icon, label }) => {
            const isCurrent = label === "Agent";

            return (
              <Button
                aria-current={isCurrent ? "page" : undefined}
                className={styles.navItem}
                disabled={!isCurrent || !hydrated}
                focusableWhenDisabled
                key={label}
                onClick={isCurrent ? focusComposer : undefined}
                type="button"
              >
                <Icon name={icon} size={16} />
                <span>{label}</span>
              </Button>
            );
          })}
        </nav>

        {showAnnouncement ? (
          <section aria-label="What's new" className={styles.announcement}>
            <p className={styles.announcementTitle}>What's new</p>
            <p>A new feature will be explained here</p>
            <Button
              aria-label="Dismiss announcement"
              className={styles.announcementDismiss}
              disabled={!hydrated}
              onClick={dismissAnnouncement}
              type="button"
            >
              <Icon name="close" size={11} />
            </Button>
          </section>
        ) : null}

        <div className={styles.profile}>
          <span aria-hidden="true" className={styles.avatar}>
            CM
          </span>
          <span className={styles.profileName}>Code Match GmbH</span>
          <Icon name="chevron-down" size={14} />
        </div>
      </aside>

      <main className={styles.mainColumn}>
        <section aria-label="Agent workspace" className={styles.workspace}>
          <header className={styles.header}>
            <span className={styles.headerButton}>
              <span>New chat</span>
              <Icon name="chevron-down" size={14} />
            </span>
          </header>

          <div className={styles.content} ref={contentRef}>
            <div className={styles.starter}>
              {chatMessages.length > 0 ? (
                <ol aria-label="Chat messages" className={styles.transcript}>
                  {chatMessages.map((message) => (
                    <li
                      className={styles.message}
                      data-role={message.role}
                      key={message.id}
                    >
                      <span className={styles.messageAuthor}>
                        {message.role === "user" ? "You" : "Agent"}
                      </span>
                      <p className={styles.messageText}>{message.text}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
              <form
                aria-label="Start a new chat"
                className={styles.composer}
                onSubmit={submitPrompt}
              >
                <Field className={styles.promptField} name="prompt">
                  <Textarea
                    aria-label="Ask Agent"
                    className={styles.textarea}
                    onValueChange={(value, { source }) => updateDraft(value, source)}
                    placeholder="Ask anything"
                    readOnly={!hydrated}
                    ref={inputRef}
                    rows={2}
                    value={draft}
                  />
                </Field>
                <div className={styles.composerActions}>
                  <span aria-hidden="true" className={styles.iconButton}>
                    <Icon name="plus" size={16} />
                  </span>
                  {chat.responding && !approval ? (
                    <Button className={styles.bridgeButton} onClick={stopResponse} type="button">
                      Stop
                    </Button>
                  ) : null}
                  <Button
                    aria-label="Submit prompt"
                    className={styles.submit}
                    disabled={!canSend}
                    focusableWhenDisabled
                    type="submit"
                  >
                    <Icon name="arrow-up" size={14} />
                  </Button>
                </div>
              </form>

              {errorMessage ? (
                <div className={styles.chatFeedback}>
                  <p className={styles.chatError} role="alert">{errorMessage}</p>
                  {chat.retry ? (
                    <Button className={styles.bridgeButton} onClick={retryResponse} type="button">
                      Retry
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {actionResult ? (
                <p className={styles.draftOutcome} role="status">
                  {DRAFT_OUTCOMES[actionResult.outcome]}
                </p>
              ) : null}

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
                    <dt>Current draft</dt>
                    <dd>{approval?.previous || "(empty)"}</dd>
                    <dt>Proposed draft</dt>
                    <dd>{approval?.value || "(empty)"}</dd>
                  </dl>
                  <div className={styles.chatFeedback}>
                    <Button className={styles.bridgeButton} onClick={stopResponse} type="button">
                      Stop
                    </Button>
                    <Button
                      className={styles.bridgeButton}
                      onClick={() => approval?.answer(false)}
                      ref={denyRef}
                      type="button"
                    >
                      Deny
                    </Button>
                    <Button
                      className={styles.bridgeButton}
                      onClick={() => draftTools.current?.revokeGrant()}
                      type="button"
                    >
                      Revoke draft access
                    </Button>
                    <Button className={styles.bridgeButton} onClick={() => approval?.answer(true)} type="button">
                      Approve
                    </Button>
                  </div>
                </AlertDialogContent>
              </AlertDialog>

              <AgentConnections
                control={inputRef}
                draft={currentDraft}
                hydrated={hydrated}
                tools={draftTools}
              />

              {showExamples ? (
                <section className={styles.examples}>
                  <div className={styles.examplesHeader}>
                    <p>Get started with some examples</p>
                    <Button
                      aria-label="Dismiss examples"
                      className={styles.iconButton}
                      disabled={!hydrated}
                      onClick={dismissExamples}
                      type="button"
                    >
                      <Icon name="close" size={12} />
                    </Button>
                  </div>

                  <div className={styles.cards}>
                    {EXAMPLES.map(({ description, icon, title }) => (
                      <Button
                        className={styles.card}
                        disabled={!hydrated}
                        key={icon}
                        onClick={() => {
                          selectExample(description);
                        }}
                        type="button"
                      >
                        <Icon name={icon} size={20} />
                        <span>
                          <span className={styles.cardTitle}>{title}</span>
                          <span className={styles.cardDescription}>
                            {description}
                          </span>
                        </span>
                      </Button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </section>

        <footer className={styles.status}>
          <span className={styles.statusLabel}>
            <Icon name="agent" size={13} />
            <span>Agent</span>
          </span>
          <span className={styles.statusMessage} role="status">
            {chat.responding ? "Agent is responding" : chat.stopped ? "Response stopped" : ""}
          </span>
          <span className={styles.statusClock}>
            <Icon name="clock" size={14} />
          </span>
        </footer>
      </main>
    </div>
  );
};
