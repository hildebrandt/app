import { parseSetDraftInput, parseSetDraftResult } from "../../packages/agent-chat-contract/set-draft.mjs";

export const DEFAULT_CONTINUATION_TTL_MS = 600_000;
export const DEFAULT_MAX_CONTINUATION_RECORDS = 512;
export const MAX_TOOL_RESULT_LENGTH = 4096;

const MAX_TOOL_CALL_ID_LENGTH = 256;
const MAX_TOOL_ARGUMENTS_LENGTH = 8192;
const SERVER_TOOL_ERROR_MESSAGE = "Set draft tool execution failed.";

/** @typedef {"changed" | "unchanged" | "denied" | "cancelled" | "unavailable" | "unknown"} SetDraftOutcome */
/** @typedef {{ outcome: SetDraftOutcome }} SetDraftResult */
/** @typedef {"pending" | "consumed" | "stopped"} ContinuationState */

/**
 * @typedef {object} ContinuationRecord
 * @property {string} owner
 * @property {string} threadId
 * @property {string} runId
 * @property {string} toolCallId
 * @property {string} args
 * @property {{ value: string }} input
 * @property {string} interruptId
 * @property {boolean} interruptKnown
 * @property {boolean} runFinished
 * @property {ContinuationState} state
 * @property {SetDraftResult} [result]
 * @property {number} createdAt
 * @property {number} expiresAt
 */

/** @typedef {import("@tanstack/ai").RunAgentResumeItem} ResumeEntry */
/**
 * @typedef {object} ParsedChatParams
 * @property {unknown[]} messages
 * @property {string} threadId
 * @property {string} runId
 * @property {string} [parentRunId]
 * @property {ResumeEntry[]} [resume]
 */

/**
 * @typedef {object} ChatRequestFailure
 * @property {400 | 403 | 409} status
 */

/**
 * @typedef {object} ChatRequestPlan
 * @property {true} ok
 * @property {import("@tanstack/ai").ModelMessage[]} messages
 * @property {string} threadId
 * @property {string} [runId]
 * @property {string} [parentRunId]
 * @property {ResumeEntry[]} [resume]
 */

/** @typedef {ChatRequestFailure | ChatRequestPlan} ChatRequestDecision */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Parsed JSON must be an object before its fields can be read.
  typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} metadata Resume entry metadata from the client. */
const isOutputError = (metadata) => {
  if (!isRecord(metadata)) {
    return false;
  }

  const tanstack = metadata.tanstack;

  return isRecord(tanstack) && tanstack.state === "output-error";
};

/** @param {unknown} payload Error payload from a client tool result. */
const readErrorPayload = (payload) => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const keys = Reflect.ownKeys(payload);

  if (keys.length !== 1 || keys[0] !== "error") {
    return undefined;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The client error payload is untrusted JSON.
  return typeof payload.error === "string" ? payload.error : undefined;
};


/** @param {number} value @param {number} fallback */
const positiveOrDefault = (value, fallback) =>
  Number.isInteger(value) && value > 0 ? value : fallback;

/**
 * @param {{ ttlMs?: number, maxRecords?: number, now?: () => number }} [options]
 */
export const createContinuationStore = (options = {}) => {
  const ttlMs = positiveOrDefault(
    options.ttlMs ?? DEFAULT_CONTINUATION_TTL_MS,
    DEFAULT_CONTINUATION_TTL_MS
  );
  const maxRecords = positiveOrDefault(
    options.maxRecords ?? DEFAULT_MAX_CONTINUATION_RECORDS,
    DEFAULT_MAX_CONTINUATION_RECORDS
  );
  const now = options.now ?? Date.now;

  /** @type {Map<string, ContinuationRecord>} */
  const records = new Map();

  /** @param {string} owner @param {string} threadId @param {string} toolCallId */
  const keyOf = (owner, threadId, toolCallId) =>
    JSON.stringify([owner, threadId, toolCallId]);

  const prune = () => {
    const current = now();

    for (const [key, record] of records) {
      if (record.expiresAt <= current) {
        records.delete(key);
      }
    }
  };

  const evict = () => {
    if (records.size <= maxRecords) {
      return;
    }

    const oldestFirst = [...records.values()].sort(
      (left, right) => left.createdAt - right.createdAt
    );

    for (const record of oldestFirst) {
      if (records.size <= maxRecords) {
        return;
      }

      if (record.state !== "pending") {
        records.delete(keyOf(record.owner, record.threadId, record.toolCallId));
      }
    }

    for (const record of oldestFirst) {
      if (records.size <= maxRecords) {
        return;
      }

      records.delete(keyOf(record.owner, record.threadId, record.toolCallId));
    }
  };

  /**
   * @param {{ owner: string, threadId: string, runId: string, toolCallId: string, input: { value: string } }} entry
   * @returns {ContinuationRecord | null}
   */
  const add = (entry) => {
    prune();

    const key = keyOf(entry.owner, entry.threadId, entry.toolCallId);

    if (records.has(key)) {
      return null;
    }

    const createdAt = now();

    const record = {
      owner: entry.owner,
      threadId: entry.threadId,
      runId: entry.runId,
      toolCallId: entry.toolCallId,
      args: JSON.stringify(entry.input),
      input: entry.input,
      interruptId: `client_tool_${entry.toolCallId}`,
      interruptKnown: false,
      runFinished: false,
      state: /** @type {const} */ ("pending"),
      createdAt,
      expiresAt: createdAt + ttlMs,
    };

    records.set(key, record);
    evict();

    return records.get(key) ?? null;
  };

  /** @param {string} owner @param {string} threadId @param {string} toolCallId */
  const get = (owner, threadId, toolCallId) => {
    prune();

    return records.get(keyOf(owner, threadId, toolCallId));
  };

  /** @param {string} owner @param {string} threadId @param {string} interruptId */
  const findByInterrupt = (owner, threadId, interruptId) => {
    prune();

    /** @type {ContinuationRecord | undefined} */
    let found;

    for (const record of records.values()) {
      if (
        record.owner !== owner ||
        record.threadId !== threadId ||
        record.interruptId !== interruptId
      ) {
        continue;
      }

      if (found !== undefined) {
        return undefined;
      }

      found = record;
    }

    return found;
  };


  /**
   * @param {string} owner
   * @param {string} threadId
   * @param {string} runId
   * @param {unknown[]} interrupts
   */
  const finishRun = (owner, threadId, runId, interrupts) => {
    const [interrupt] = interrupts;
    if (interrupts.length !== 1 || !isRecord(interrupt)) {
      return false;
    }

    const { id, toolCallId, metadata } = interrupt;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof toolCallId !== "string" ||
      !isRecord(metadata) ||
      metadata.kind !== "client_tool" ||
      metadata.toolName !== "set_draft"
    ) {
      return false;
    }

    const record = get(owner, threadId, toolCallId);
    const input = parseSetDraftInput(metadata.input);
    if (
      record?.state !== "pending" ||
      record.runId !== runId ||
      record.runFinished ||
      input?.value !== record.input.value
    ) {
      return false;
    }

    record.interruptId = id;
    record.interruptKnown = true;
    record.runFinished = true;
    return true;
  };

  /** @param {string} owner @param {string} threadId @param {string} runId */
  const stopRun = (owner, threadId, runId) => {
    for (const record of records.values()) {
      if (
        record.owner !== owner ||
        record.threadId !== threadId ||
        record.runId !== runId
      ) {
        continue;
      }

      record.runFinished = true;

      if (record.state === "pending") {
        record.state = "stopped";
      }
    }
  };

  /**
   * @param {ContinuationRecord} record
   * @param {SetDraftResult} result
   */
  const consume = (record, result) => {
    prune();

    const current = records.get(
      keyOf(record.owner, record.threadId, record.toolCallId)
    );

    if (
      current === undefined ||
      current !== record ||
      current.state !== "pending" ||
      current.runFinished !== true
    ) {
      return null;
    }

    current.state = "consumed";
    current.result = result;
    current.expiresAt = now() + ttlMs;

    return current;
  };

  /** @param {string} owner @param {string} threadId */
  const consumedFor = (owner, threadId) => {
    prune();

    /** @type {ContinuationRecord[]} */
    const consumed = [];

    for (const record of records.values()) {
      if (
        record.owner === owner &&
        record.threadId === threadId &&
        record.state === "consumed" &&
        record.result !== undefined
      ) {
        consumed.push(record);
      }
    }

    return consumed;
  };

  return {
    add,
    get,
    findByInterrupt,
    finishRun,
    stopRun,
    consume,
    consumedFor,
  };
};

/**
 * @param {unknown[]} messages Parsed browser messages.
 * @returns {import("@tanstack/ai").ModelMessage[] | null}
 */
export const projectTextHistory = (messages) => {
  /** @type {import("@tanstack/ai").ModelMessage[]} */
  const projected = [];
  let hasUser = false;

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }

    const { role, content } = message;

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Message text from the browser is untrusted.
    if (typeof content !== "string" || content.length === 0) {
      continue;
    }

    if (role === "user") {
      projected.push({ role: "user", content });
      hasUser = true;
    } else if (role === "assistant") {
      projected.push({ role: "assistant", content });
    }
  }

  return hasUser ? projected : null;
};

/** @param {ContinuationRecord} record */
const toToolCall = (record) => ({
  id: record.toolCallId,
  type: /** @type {const} */ ("function"),
  function: {
    name: "set_draft",
    arguments: record.args,
  },
});

/**
 * @param {object} input
 * @param {unknown[]} input.messages Parsed browser messages.
 * @param {ReturnType<typeof createContinuationStore>} input.store Accepted continuation records.
 * @param {string} input.owner Verified request owner.
 * @param {string} input.threadId Request thread ID.
 * @param {ContinuationRecord} [input.claimRecord] Record being claimed by this request.
 * @param {SetDraftResult} [input.claimResult] Result validated for the claim.
 * @param {string} [input.nativeToolCallId] Native resume omits the tool row; resume carries the result.
 * @returns {import("@tanstack/ai").ModelMessage[] | null}
 */
export const projectTrustedHistory = ({
  messages,
  store,
  owner,
  threadId,
  claimRecord,
  claimResult,
  nativeToolCallId,
}) => {
  /** @type {Map<string, ContinuationRecord>} */
  const accepted = new Map();

  for (const record of store.consumedFor(owner, threadId)) {
    accepted.set(record.toolCallId, record);
  }

  if (claimRecord !== undefined && claimResult !== undefined) {
    accepted.set(claimRecord.toolCallId, {
      ...claimRecord,
      state: "consumed",
      result: claimResult,
    });
  }

  /** @type {Set<string>} */
  const toolRows = new Set();

  for (const message of messages) {
    if (!isRecord(message) || message.role !== "tool") {
      continue;
    }

    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The tool call ID comes from untrusted JSON.
    if (typeof message.toolCallId === "string") {
      toolRows.add(message.toolCallId);
    }
  }

  /** @type {import("@tanstack/ai").ModelMessage[]} */
  const projected = [];
  /** @type {Set<string>} */
  const attachedCalls = new Set();
  /** @type {Set<string>} */
  const emittedResults = new Set();
  let hasUser = false;

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }

    const { role, content } = message;

    if (role === "user") {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Message text from the browser is untrusted.
      if (typeof content === "string" && content.length > 0) {
        projected.push({ role: "user", content });
        hasUser = true;
      }

      continue;
    }

    if (role === "assistant") {
      const text =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Message text from the browser is untrusted.
        typeof content === "string" && content.length > 0 ? content : null;

      /** @type {import("@tanstack/ai").ToolCall[]} */
      const calls = [];
      const inputCalls = Array.isArray(message.toolCalls)
        ? message.toolCalls
        : [];

      for (const call of inputCalls) {
        if (!isRecord(call)) {
          continue;
        }

        const { id } = call;

        if (
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The tool call ID comes from untrusted JSON.
          typeof id !== "string" ||
          id.length === 0 ||
          attachedCalls.has(id)
        ) {
          continue;
        }

        const record = accepted.get(id);

        if (record === undefined) {
          continue;
        }

        if (id !== nativeToolCallId && !toolRows.has(id)) {
          continue;
        }

        calls.push(toToolCall(record));
        attachedCalls.add(id);
      }

      if (calls.length > 0) {
        projected.push({ role: "assistant", content: text, toolCalls: calls });
      } else if (text !== null) {
        projected.push({ role: "assistant", content: text });
      }

      continue;
    }

    if (role === "tool") {
      const { toolCallId } = message;

      if (
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The tool call ID comes from untrusted JSON.
        typeof toolCallId !== "string" ||
        toolCallId.length === 0 ||
        emittedResults.has(toolCallId) ||
        toolCallId === nativeToolCallId
      ) {
        continue;
      }

      const record = accepted.get(toolCallId);

      if (record === undefined || record.result === undefined) {
        continue;
      }

      if (!attachedCalls.has(toolCallId)) {
        projected.push({
          role: "assistant",
          content: null,
          toolCalls: [toToolCall(record)],
        });
        attachedCalls.add(toolCallId);
      }

      projected.push({
        role: "tool",
        content: JSON.stringify(record.result),
        toolCallId,
      });

      emittedResults.add(toolCallId);
    }
  }

  if (
    nativeToolCallId !== undefined &&
    !attachedCalls.has(nativeToolCallId) &&
    accepted.has(nativeToolCallId)
  ) {
    const record = accepted.get(nativeToolCallId);

    if (record !== undefined) {
      projected.push({
        role: "assistant",
        content: null,
        toolCalls: [toToolCall(record)],
      });
    }
  }

  return hasUser ? projected : null;
};

/**
 * @param {object} input
 * @param {ParsedChatParams} input.params Parsed AG-UI request.
 * @param {string | null} input.owner Verified request owner.
 * @param {ReturnType<typeof createContinuationStore>} input.store Continuation records.
 * @param {string | undefined} input.runId Validated request run ID.
 * @param {string | undefined} input.parentRunId Validated parent run ID.
 * @returns {ChatRequestDecision}
 */
export const prepareChatRequest = ({
  params,
  owner,
  store,
  runId,
  parentRunId,
}) => {
  const { messages, threadId } = params;

  for (const message of messages) {
    if (
      !isRecord(message) ||
      (message.role !== "user" &&
        message.role !== "assistant" &&
        message.role !== "tool")
    ) {
      return { status: 400 };
    }
  }

  const last = messages.at(-1);

  if (owner === null) {
    const hasClaim =
      (params.resume !== undefined && params.resume.length > 0) ||
      parentRunId !== undefined ||
      (isRecord(last) && last.role === "tool");

    if (hasClaim) {
      return { status: 403 };
    }

    const textHistory = projectTextHistory(messages);

    return textHistory === null
      ? { status: 400 }
      : { ok: true, messages: textHistory, threadId, runId };
  }

  const resume = params.resume;

  if (resume !== undefined && resume.length > 0) {
    if (resume.length !== 1 || parentRunId === undefined) {
      return { status: 400 };
    }

    const entry = resume[0];
    if (entry === undefined) {
      return { status: 400 };
    }

    const record = store.findByInterrupt(owner, threadId, entry.interruptId);

    if (record === undefined) {
      return { status: 409 };
    }

    if (
      record.state !== "pending" ||
      record.runFinished !== true ||
      record.interruptKnown !== true
    ) {
      return { status: 409 };
    }

    if (record.runId !== parentRunId) {
      return { status: 409 };
    }

    /** @type {SetDraftResult} */
    let result;
    /** @type {ResumeEntry} */
    let resumeEntry;

    if (entry.status === "cancelled") {
      if (entry.payload !== undefined) {
        return { status: 400 };
      }

      result = { outcome: "cancelled" };
      resumeEntry = {
        interruptId: record.interruptId,
        status: "cancelled",
      };
    } else if (isOutputError(entry.metadata)) {
      const error = readErrorPayload(entry.payload);

      if (error === undefined || error.length > MAX_TOOL_RESULT_LENGTH) {
        return { status: 400 };
      }

      result = { outcome: "unavailable" };
      resumeEntry = {
        interruptId: record.interruptId,
        status: "resolved",
        payload: { error: SERVER_TOOL_ERROR_MESSAGE },
        metadata: { tanstack: { state: "output-error" } },
      };
    } else {
      const parsed = parseSetDraftResult(entry.payload);

      if (parsed === null) {
        return { status: 400 };
      }

      result = parsed;
      resumeEntry = {
        interruptId: record.interruptId,
        status: "resolved",
        payload: parsed,
      };
    }

    const history = projectTrustedHistory({
      messages,
      store,
      owner,
      threadId,
      claimRecord: record,
      claimResult: result,
      nativeToolCallId: record.toolCallId,
    });

    if (history === null) {
      return { status: 400 };
    }

    if (store.consume(record, result) === null) {
      return { status: 409 };
    }

    return {
      ok: true,
      messages: history,
      threadId,
      runId,
      parentRunId,
      resume: [resumeEntry],
    };
  }

  if (isRecord(last) && last.role === "tool") {
    const toolCallId = last.toolCallId;

    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      return { status: 400 };
    }

    const record = store.get(owner, threadId, toolCallId);

    if (record === undefined) {
      return { status: 409 };
    }

    if (record.state !== "pending" || record.runFinished !== true) {
      return { status: 409 };
    }

    if (parentRunId !== undefined && parentRunId !== record.runId) {
      return { status: 409 };
    }

    /** @type {SetDraftResult} */
    let result;

    if (last.error !== undefined) {
      if (
        typeof last.error !== "string" ||
        last.error.length > MAX_TOOL_RESULT_LENGTH
      ) {
        return { status: 400 };
      }

      result = { outcome: "unavailable" };
    } else {
      if (
        typeof last.content !== "string" ||
        last.content.length > MAX_TOOL_RESULT_LENGTH
      ) {
        return { status: 400 };
      }

      /** @type {unknown} */
      let payload;

      try {
        payload = JSON.parse(last.content);
      } catch {
        return { status: 400 };
      }

      const parsed = parseSetDraftResult(payload);

      if (parsed === null) {
        return { status: 400 };
      }

      result = parsed;
    }

    const history = projectTrustedHistory({
      messages,
      store,
      owner,
      threadId,
      claimRecord: record,
      claimResult: result,
    });

    if (history === null) {
      return { status: 400 };
    }

    if (store.consume(record, result) === null) {
      return { status: 409 };
    }

    return { ok: true, messages: history, threadId, runId, parentRunId };
  }

  if (parentRunId !== undefined) {
    return { status: 409 };
  }

  const history = projectTrustedHistory({
    messages,
    store,
    owner,
    threadId,
  });

  return history === null
    ? { status: 400 }
    : { ok: true, messages: history, threadId, runId, parentRunId };
};

