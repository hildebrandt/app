import { toolDefinition } from "@tanstack/ai";
import { clientTools, useChat } from "@tanstack/ai-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  parseSetDraftInput,
  setDraftToolSpec,
  type SetDraftResult,
} from "../../../../packages/agent-chat-contract/set-draft.mjs";
import { chatConnection, interruptedMessage } from "./-agent-chat-connection";
import type { DraftTools } from "./-agent-tools";

type Proposal = { previous: string; value: string };
type Approval = Proposal & { answer: (approved: boolean) => void };
type Turn = {
  failed: boolean;
  stopped: boolean;
  action: { id: string; value: string; result: Promise<SetDraftResult>; pending: boolean } | null;
};

const setDraft = toolDefinition(setDraftToolSpec);
const cancelled: SetDraftResult = { outcome: "cancelled" };
const unavailable: SetDraftResult = { outcome: "unavailable" };
const unknown: SetDraftResult = { outcome: "unknown" };

export const useAgentChat = (threadId: string, runtime: RefObject<DraftTools | null>) => {
  const active = useRef<Turn | null>(null);
  const [activity, setActivity] = useState<"idle" | "running" | "stopping">("idle");
  const [stopped, setStopped] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [hasAction, setHasAction] = useState(false);
  const [actionResult, setActionResult] = useState<SetDraftResult | null>(null);

  useEffect(() => () => {
    if (active.current) {
      active.current.stopped = true;
      active.current = null;
    }
  }, []);

  const tools = useMemo(() => clientTools(setDraft.client((input, context) => {
    const turn = active.current;
    const executor = runtime.current;
    const parsed = parseSetDraftInput(input);
    const id = context?.toolCallId;
    const signal = context?.abortSignal;
    if (!turn || turn.stopped || !id || !signal || signal.aborted || context.threadId !== threadId) {
      return cancelled;
    }
    if (!parsed) {
      return unavailable;
    }
    if (turn.action) {
      return turn.action.id === id && turn.action.value === parsed.value
        ? turn.action.result
        : unavailable;
    }

    setHasAction(true);
    const ownsAction = () => active.current === turn && !turn.stopped && !signal.aborted;
    const approve = (proposal: Proposal, approvalSignal: AbortSignal) =>
      new Promise<boolean>((resolve) => {
        if (!ownsAction() || approvalSignal.aborted) {
          resolve(false);
          return;
        }
        const request: Approval = {
          ...proposal,
          answer(approved) {
            approvalSignal.removeEventListener("abort", abort);
            setApproval((current) => (current === request ? null : current));
            resolve(approved && ownsAction() && !approvalSignal.aborted);
          },
        };
        const abort = () => request.answer(false);
        approvalSignal.addEventListener("abort", abort, { once: true });
        setApproval(request);
      });
    const publish = (result: SetDraftResult) => {
      if (ownsAction()) {
        setActionResult(result);
      }
    };
    const result = Promise.resolve().then(async () => {
      if (!ownsAction()) {
        return cancelled;
      }
      const observed = executor
        ? await executor.runProtectedSetDraft(parsed, { signal, approve, onObserved: publish })
        : unavailable;
      publish(observed);
      return ownsAction() ? observed : cancelled;
    }).catch(() => {
      publish(unknown);
      return ownsAction() ? unknown : cancelled;
    }).finally(() => {
      if (turn.action) {
        turn.action.pending = false;
      }
    });
    turn.action = { id, value: parsed.value, result, pending: true };
    return result;
  })), [runtime, threadId]);

  const { error, isLoading, messages, reload, sendMessage, stop } = useChat({
    connection: chatConnection,
    onError: () => {
      if (active.current) {
        active.current.failed = true;
      }
    },
    threadId,
    tools,
  });

  const startTurn = (send: () => Promise<void>): boolean => {
    if (active.current) {
      return false;
    }
    const turn: Turn = { failed: false, stopped: false, action: null };
    active.current = turn;
    setActivity("running");
    setStopped(false);
    setHasAction(false);
    setActionResult(null);
    const finish = () => {
      if (active.current === turn) {
        active.current = null;
        if (!turn.stopped && turn.action && (turn.failed || turn.action.pending)) {
          stop();
        }
        setActivity("idle");
      }
    };
    void send().then(finish, finish);
    return true;
  };

  const stopResponse = () => {
    const turn = active.current;
    if (!turn || turn.stopped) {
      return;
    }
    turn.stopped = true;
    setActivity("stopping");
    setStopped(true);
    stop();
  };
  const errorMessage = activity === "idle" && !isLoading && !stopped && error
    ? hasAction
      ? "Could not confirm the response after the draft action. Check the draft before starting a new turn."
      : error.message === interruptedMessage ? interruptedMessage : "Chat is unavailable. Try again."
    : null;

  return {
    approval,
    actionResult,
    busy: activity !== "idle" || isLoading,
    responding: activity === "running" || (isLoading && !stopped),
    errorMessage,
    messages,
    stopped,
    stopResponse,
    submit: (prompt: string) => startTurn(() => {
      if (errorMessage && hasAction) {
        stop();
      }
      return sendMessage(prompt);
    }),
    retry: errorMessage && !hasAction ? () => startTurn(reload) : null,
  };
};
