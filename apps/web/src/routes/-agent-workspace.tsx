import { useHydrated } from "@tanstack/react-router";
import { Button } from "@ui-sdk/react/button";
import { Field } from "@ui-sdk/react/field";
import { Textarea } from "@ui-sdk/react/textarea";
import { useRef, useState } from "react";

import styles from "../styles/agent-workspace.module.css";

import { AgentConnections } from "./-agent-connections";
import { Icon, type IconName } from "./-agent-icon";
import type { DraftTools } from "./-agent-tools";

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

export const AgentWorkspace = () => {
  const hydrated = useHydrated();
  const [draft, setDraft] = useState("");
  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const [showExamples, setShowExamples] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentDraft = useRef("");
  const draftTools = useRef<DraftTools | null>(null);

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

          <div className={styles.content}>
            <div className={styles.starter}>
              <form
                aria-label="Start a new chat"
                className={styles.composer}
                onSubmit={(event) => {
                  event.preventDefault();
                }}
              >
                <Field className={styles.promptField} name="prompt">
                  <Textarea
                    aria-label="Ask Agent"
                    className={styles.textarea}
                    onValueChange={(value, { source }) => updateDraft(value, source)}
                    placeholder="Ask agent.."
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
                  <Button
                    aria-description="Sending is not connected."
                    aria-label="Submit prompt"
                    className={styles.submit}
                    disabled
                    focusableWhenDisabled
                    type="submit"
                  >
                    <Icon name="arrow-up" size={14} />
                  </Button>
                </div>
              </form>
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
          <span className={styles.statusClock}>
            <Icon name="clock" size={14} />
          </span>
        </footer>
      </main>
    </div>
  );
};
