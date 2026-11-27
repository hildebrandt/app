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
};

export type DraftTools = {
  list: () => readonly DraftToolDefinition[];
  call: (name: unknown, input: unknown) => Promise<DraftToolResult>;
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
  observedPrevious?: string;
  permissionDenied: boolean;
  value: string;
};

const fail = (error: DraftToolError): DraftToolResult => ({ ok: false, error });

const succeed = (change: DraftToolChange | null): DraftToolResult => ({ ok: true, change });

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
    if (typeof value !== "string") {
      return null;
    }
    if (value.length > DRAFT_VALUE_SCHEMA.maxLength) {
      let codePoints = 0;
      for (const _codePoint of value) {
        codePoints += 1;
        if (codePoints > DRAFT_VALUE_SCHEMA.maxLength) {
          return null;
        }
      }
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

export const createDraftTools = ({ getControl, getDraft, isGranted }: DraftToolsOptions): DraftTools => {
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

  const allowStep = (step: AgentAction): boolean => {
    const action = activeAction;
    if (!action) {
      return false;
    }
    if (!permitted()) {
      action.permissionDenied = true;
      return false;
    }
    return (
      !action.controller.signal.aborted &&
      step.confirm === undefined &&
      step.component === "textarea" &&
      step.label === DRAFT_LABEL &&
      step.action === "setValue" &&
      step.args.length === 1 &&
      step.args[0] === action.value &&
      readControl() === action.control &&
      targetsControl(step.ref, action.control)
    );
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
      control,
      controller: new AbortController(),
      permissionDenied: false,
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

  return { list, call, resetUndo, dispose };
};
