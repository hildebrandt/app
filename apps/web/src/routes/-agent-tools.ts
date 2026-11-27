import {
  type AgentAction,
  createAgent,
  type ObservedChange,
} from "@ui-sdk/react/agent";
import { elementOf } from "@ui-sdk/react/observe";

const DRAFT_LABEL = "Ask Agent";

type DraftToolName = "set_draft" | "undo_draft";

export type DraftToolError =
  | "permission_denied"
  | "invalid_arguments"
  | "unknown_tool"
  | "action_failed"
  | "busy";

export type DraftToolChange = {
  type: "draft.changed";
  key: "value";
  label: typeof DRAFT_LABEL;
  source: "agent";
};

export type DraftToolResult =
  | { ok: true; change: DraftToolChange | null }
  | { ok: false; error: DraftToolError };
export type DraftToolOutcome =
  | "changed"
  | "unchanged"
  | "denied"
  | "cancelled"
  | "unavailable"
  | "unknown";

export type ProtectedDraftProposal = {
  previous: string;
  value: string;
};

export type ProtectedDraftOptions = {
  signal: AbortSignal;
  approve: (
    proposal: ProtectedDraftProposal,
    signal: AbortSignal,
  ) => Promise<boolean>;
  onObserved?: (result: ProtectedDraftResult) => void;
};

export type ProtectedDraftResult = {
  outcome: DraftToolOutcome;
};

type ProtectedRefusal = "cancelled" | "denied" | "unavailable";

export type DraftToolDefinition = {
  readonly name: DraftToolName;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, { readonly type: "string" }>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
};

export type DraftToolsOptions = {
  getControl: () => HTMLTextAreaElement | null;
  getDraft: () => string;
  isGranted: () => boolean;
  setGrant: (granted: boolean) => void;
};

export type DraftTools = {
  list: () => readonly DraftToolDefinition[];
  call: (name: unknown, input: unknown) => Promise<DraftToolResult>;
  runProtectedSetDraft: (
    input: unknown,
    options: ProtectedDraftOptions,
  ) => Promise<ProtectedDraftResult>;
  cancelProtected: () => void;
  revokeGrant: () => void;
  resetUndo: () => void;
  dispose: () => void;
};

const DRAFT_VALUE_SCHEMA = { type: "string", maxLength: 4000 } as const;

const SET_DRAFT_INPUT = {
  type: "object",
  properties: {
    value: DRAFT_VALUE_SCHEMA,
  },
  required: ["value"],
  additionalProperties: false,
} as const satisfies DraftToolDefinition["inputSchema"];

const UNDO_DRAFT_INPUT = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const satisfies DraftToolDefinition["inputSchema"];

const DRAFT_TOOL_DEFINITIONS = [
  {
    name: "set_draft",
    description: "Replace the text in the Ask Agent draft. The user must allow agents to edit the draft.",
    inputSchema: SET_DRAFT_INPUT,
  },
  {
    name: "undo_draft",
    description: "Restore the Ask Agent draft to its value before the last agent change. Does nothing when there is no agent change to undo.",
    inputSchema: UNDO_DRAFT_INPUT,
  },
] as const satisfies readonly DraftToolDefinition[];

type UndoSlot = {
  control: HTMLTextAreaElement;
  previous: string;
  applied: string;
};

type DraftAction = {
  control: HTMLTextAreaElement;
  controller: AbortController;
  commit: (() => void) | null;
  committed: boolean;
  expectedPrevious: string | undefined;
  kind: "external" | "protected";
  observedPrevious: string | undefined;
  permissionDenied: boolean;
  refusal: ProtectedRefusal | null;
  value: string;
};

const fail = (error: DraftToolError): DraftToolResult => ({ ok: false, error });

const succeed = (change: DraftToolChange | null): DraftToolResult => ({ ok: true, change });

const protectedResult = (outcome: DraftToolOutcome): ProtectedDraftResult => ({
  outcome,
});

const linkAbort = (
  source: AbortSignal,
  target: AbortController,
): (() => void) => {
  const forward = () => target.abort();
  source.addEventListener("abort", forward, { once: true });
  if (source.aborted) {
    target.abort();
  }
  return () => source.removeEventListener("abort", forward);
};

type ApprovalDecision = "approved" | "denied" | "cancelled" | "unknown";

const awaitApproval = async (
  approve: ProtectedDraftOptions["approve"],
  proposal: ProtectedDraftProposal,
  signal: AbortSignal,
): Promise<ApprovalDecision> => {
  if (signal.aborted) {
    return "cancelled";
  }
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<ApprovalDecision>((resolve) => {
    onAbort = () => resolve("cancelled");
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      approve(proposal, signal).then(
        (approved): ApprovalDecision => (approved ? "approved" : "denied"),
        (): ApprovalDecision => "unknown",
      ),
      cancelled,
    ]);
  } catch {
    return "unknown";
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

const matchesSchema = (
  input: object,
  schema: DraftToolDefinition["inputSchema"],
): boolean => {
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== schema.required.length) {
    return false;
  }
  for (const key of ownKeys) {
    if (typeof key === "symbol" || !Object.hasOwn(schema.properties, key)) {
      return false;
    }
  }
  return schema.required.every((key) => Object.hasOwn(input, key));
};

const draftValueFits = (value: string): boolean => {
  if (value.length <= DRAFT_VALUE_SCHEMA.maxLength) {
    return true;
  }
  let codePoints = 0;
  for (const _codePoint of value) {
    codePoints += 1;
    if (codePoints > DRAFT_VALUE_SCHEMA.maxLength) {
      return false;
    }
  }
  return true;
};

const parseSetDraftInput = (input: unknown): string | null => {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return null;
    }
    const prototype = Object.getPrototypeOf(input);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      !matchesSchema(input, SET_DRAFT_INPUT)
    ) {
      return null;
    }
    const value = Reflect.get(input, "value");
    if (typeof value !== "string" || !draftValueFits(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

const isUndoDraftInput = (input: unknown): boolean => {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(input);
    return (prototype === Object.prototype || prototype === null) &&
      matchesSchema(input, UNDO_DRAFT_INPUT);
  } catch {
    return false;
  }
};

const targetsControl = (ref: string, control: HTMLTextAreaElement): boolean => {
  try {
    return elementOf(ref) === control;
  } catch {
    return false;
  }
};

export const createDraftTools = ({
  getControl,
  getDraft,
  isGranted,
  setGrant,
}: DraftToolsOptions): DraftTools => {
  let undo: UndoSlot | null = null;
  let disposed = false;
  let activeAction: DraftAction | null = null;

  const permitted = (): boolean => {
    if (disposed) {
      return false;
    }
    try {
      return isGranted();
    } catch {
      return false;
    }
  };

  const readControl = (): HTMLTextAreaElement | null => {
    try {
      const control = getControl();
      return control instanceof HTMLTextAreaElement && control.isConnected ? control : null;
    } catch {
      return null;
    }
  };

  const readDraft = (): string | null => {
    try {
      const value = getDraft();
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  };

  const refuseProtected = (
    action: DraftAction,
    reason: ProtectedRefusal,
  ): void => {
    if (action.kind === "protected") {
      action.refusal ??= reason;
    }
  };

  const allowStep = (step: AgentAction): boolean => {
    const action = activeAction;
    if (!action) {
      return false;
    }
    if (action.kind === "protected" && action.controller.signal.aborted) {
      action.refusal ??= "cancelled";
      return false;
    }
    if (!permitted()) {
      if (action.kind === "protected") {
        action.refusal ??= "unavailable";
      } else {
        action.permissionDenied = true;
      }
      return false;
    }
    if (action.controller.signal.aborted) {
      return false;
    }
    if (
      action.expectedPrevious !== undefined &&
      readDraft() !== action.expectedPrevious
    ) {
      refuseProtected(action, "unavailable");
      return false;
    }
    const allowed =
      step.confirm === undefined &&
      step.component === "textarea" &&
      step.label === DRAFT_LABEL &&
      step.action === "setValue" &&
      step.args.length === 1 &&
      step.args[0] === action.value &&
      readControl() === action.control &&
      targetsControl(step.ref, action.control);
    if (!allowed) {
      refuseProtected(action, "unavailable");
    }
    return allowed;
  };

  const agent = createAgent({ allow: allowStep });
  const unsubscribe = agent.subscribe((change: ObservedChange) => {
    if (change.component !== "textarea" || change.key !== "value") {
      return;
    }
    const control = readControl();
    if (control === null || !targetsControl(change.ref, control)) {
      return;
    }
    if (change.source === "agent") {
      if (
        activeAction?.control === control &&
        change.value === activeAction.value &&
        typeof change.previous === "string"
      ) {
        activeAction.observedPrevious = change.previous;
        if (
          activeAction.kind === "protected" &&
          !activeAction.committed &&
          change.previous === activeAction.expectedPrevious &&
          permitted() &&
          control.isConnected &&
          readControl() === control &&
          control.value === change.value
        ) {
          activeAction.commit?.();
        }
      }
      return;
    }
    resetUndo();
  });

  const validUndo = (control: HTMLTextAreaElement, current: string): UndoSlot | null => {
    if (undo !== null && (undo.control !== control || undo.applied !== current)) {
      undo = null;
    }
    return undo;
  };

  const runAgentChange = async (
    control: HTMLTextAreaElement,
    value: string,
    onApplied: (previous: string) => void,
  ): Promise<DraftToolResult> => {
    const action: DraftAction = {
      commit: null,
      committed: false,
      control,
      controller: new AbortController(),
      expectedPrevious: undefined,
      kind: "external",
      observedPrevious: undefined,
      permissionDenied: false,
      refusal: null,
      value,
    };
    activeAction = action;
    try {
      const result = await agent.act(
        { steps: [{ ref: DRAFT_LABEL, action: "setValue", args: [value] }] },
        { signal: action.controller.signal },
      );
      if (disposed) {
        return fail("action_failed");
      }
      if (action.permissionDenied) {
        return fail("permission_denied");
      }
      if (!result.ok) {
        return fail("action_failed");
      }
      const previous = action.observedPrevious;
      if (action.controller.signal.aborted || previous === undefined) {
        return fail("action_failed");
      }
      if (readControl() !== control || readDraft() !== value) {
        return fail("action_failed");
      }
      onApplied(previous);
      return succeed({
        type: "draft.changed",
        key: "value",
        label: DRAFT_LABEL,
        source: "agent",
      });
    } catch {
      return fail(action.permissionDenied ? "permission_denied" : "action_failed");
    } finally {
      activeAction = null;
    }
  };

  const runProtectedSetDraft = async (
    input: unknown,
    { approve, onObserved, signal }: ProtectedDraftOptions,
  ): Promise<ProtectedDraftResult> => {
    let published = false;
    const publish = (outcome: DraftToolOutcome): ProtectedDraftResult => {
      if (!published) {
        published = true;
        try {
          onObserved?.(protectedResult(outcome));
        } catch {
          // Reporting a result must not change the protected outcome.
        }
      }
      return protectedResult(outcome);
    };
    if (disposed || activeAction !== null) {
      return publish("unavailable");
    }
    const parsed = typeof input === "string" ? input : parseSetDraftInput(input);
    if (parsed === null || !draftValueFits(parsed)) {
      return publish("unavailable");
    }
    if (!permitted()) {
      return publish("unavailable");
    }
    if (signal.aborted) {
      return publish("cancelled");
    }
    const control = readControl();
    const previous = readDraft();
    if (control === null || previous === null) {
      return publish("unavailable");
    }
    const value = parsed.replace(/\r\n?/gu, "\n");
    if (previous === value) {
      return publish("unchanged");
    }

    const action: DraftAction = {
      commit: null,
      committed: false,
      control,
      controller: new AbortController(),
      expectedPrevious: previous,
      kind: "protected",
      observedPrevious: undefined,
      permissionDenied: false,
      refusal: null,
      value,
    };
    action.commit = () => {
      if (action.committed) {
        return;
      }
      action.committed = true;
      undo = {
        control,
        previous: action.observedPrevious ?? previous,
        applied: value,
      };
      publish("changed");
    };
    const unlink = linkAbort(signal, action.controller);
    activeAction = action;
    try {
      const decision = await awaitApproval(
        approve,
        { previous, value },
        action.controller.signal,
      );
      if (action.committed) {
        return publish("changed");
      }
      if (decision === "cancelled" || action.controller.signal.aborted) {
        return publish("cancelled");
      }
      if (decision === "denied") {
        return publish("denied");
      }
      if (decision === "unknown") {
        return publish("unknown");
      }
      if (disposed) {
        return publish("cancelled");
      }
      if (
        !permitted() ||
        readControl() !== control ||
        readDraft() !== previous
      ) {
        return publish("unavailable");
      }

      action.observedPrevious = undefined;
      try {
        await agent.act(
          { steps: [{ ref: DRAFT_LABEL, action: "setValue", args: [value] }] },
          { signal: action.controller.signal },
        );
      } catch {
        // The observed change decides whether the edit committed despite this.
      }

      if (action.committed) {
        return publish("changed");
      }
      const observed = action.observedPrevious;
      if (observed !== undefined) {
        if (readControl() === control && readDraft() === value) {
          undo = { control, previous: observed, applied: value };
          return publish("changed");
        }
        return publish("unknown");
      }
      if (action.controller.signal.aborted) {
        return publish(
          readControl() === control && readDraft() === value
            ? "unknown"
            : "cancelled",
        );
      }
      if (action.refusal !== null) {
        return publish(action.refusal);
      }
      return publish("unknown");
    } catch {
      return publish("unknown");
    } finally {
      unlink();
      if (activeAction === action) {
        activeAction = null;
      }
    }
  };

  const setDraft = async (value: string): Promise<DraftToolResult> => {
    const control = readControl();
    if (control === null) {
      return fail("action_failed");
    }
    const current = readDraft();
    if (current === null) {
      return fail("action_failed");
    }
    validUndo(control, current);
    if (current === value) {
      return succeed(null);
    }
    return runAgentChange(control, value, (previous) => {
      undo = { control, previous, applied: value };
    });
  };

  const undoDraft = async (): Promise<DraftToolResult> => {
    const control = readControl();
    if (control === null) {
      return fail("action_failed");
    }
    const current = readDraft();
    if (current === null) {
      return fail("action_failed");
    }
    const slot = validUndo(control, current);
    if (slot === null) {
      return succeed(null);
    }
    if (slot.previous === current) {
      undo = null;
      return succeed(null);
    }
    return runAgentChange(control, slot.previous, () => {
      undo = null;
    });
  };

  const list = (): readonly DraftToolDefinition[] =>
    disposed ? [] : DRAFT_TOOL_DEFINITIONS;

  const call = async (name: unknown, input: unknown): Promise<DraftToolResult> => {
    try {
      if (disposed) {
        return fail("action_failed");
      }
      if (name !== "set_draft" && name !== "undo_draft") {
        return fail("unknown_tool");
      }
      if (!permitted()) {
        return fail("permission_denied");
      }
      if (activeAction) {
        return fail("busy");
      }
      if (name === "set_draft") {
        const value = parseSetDraftInput(input);
        if (value === null) {
          return fail("invalid_arguments");
        }
        return await setDraft(value.replace(/\r\n?/gu, "\n"));
      }
      if (!isUndoDraftInput(input)) {
        return fail("invalid_arguments");
      }
      return await undoDraft();
    } catch {
      return fail("action_failed");
    }
  };

  const cancelProtected = (): void => {
    if (activeAction?.kind === "protected") {
      activeAction.controller.abort();
    }
  };
  const revokeGrant = (): void => {
    cancelProtected();
    setGrant(false);
  };

  const resetUndo = (): void => {
    undo = null;
    activeAction?.controller.abort();
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    undo = null;
    unsubscribe();
    activeAction?.controller.abort();
  };

  return {
    list,
    call,
    runProtectedSetDraft,
    cancelProtected,
    revokeGrant,
    resetUndo,
    dispose,
  };
};
