import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-features=WebMCP"] } });

type JsonRecord = Record<string, unknown>;

type NativeTool = {
  description: string;
  frameId: string;
  inputSchema?: unknown;
  name: string;
  toolId: string;
};

type RemovedNativeTool = Pick<NativeTool, "frameId" | "name" | "toolId">;

type NativeReply = {
  invocationId: string;
  output?: {
    content?: unknown[];
    isError?: boolean;
  };
  status: string;
};

type ToolCall = (
  name: string,
  input: Record<string, string>,
) => Promise<unknown>;

const bridgeScript = fileURLToPath(
  new URL("../../../apps/web/scripts/agent-bridge.mjs", import.meta.url),
);
const setName = "set_draft";
const undoName = "undo_draft";
const initialDraft = "Draft written by the user";
const agentDraft = "Draft from the agent";
const manualDraft = "New manual draft";
const setArguments = { value: agentDraft };
const multilineDraft = "First line\r\nSecond line\rThird line";
const multilineLfDraft = "First line\nSecond line\nThird line";
const multilineArguments = { value: multilineDraft };
const multilineLfArguments = { value: multilineLfDraft };
const draftCodePointLimit = 4000;
const limitDraft = "😀".repeat(draftCodePointLimit);
const overLimitDraft = `${limitDraft}😀`;
const overLimitArguments = { value: overLimitDraft };
const changed = {
  change: {
    key: "value",
    label: "Ask Agent",
    source: "agent",
    type: "draft.changed",
  },
  ok: true,
};
const unchanged = { change: null, ok: true };
const denied = { error: "permission_denied", ok: false };
const invalidArguments = { error: "invalid_arguments", ok: false };
const bridgeUrlPattern = /^ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/u;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBridgeTool = (value: unknown) => {
  if (!isRecord(value)) {
    throw new Error(`The bridge listed a non-object tool: ${String(value)}`);
  }
  const { description, inputSchema, name } = value;
  if (
    typeof description !== "string" ||
    typeof name !== "string" ||
    !isRecord(inputSchema)
  ) {
    throw new Error(`The bridge listed an incomplete tool: ${name}`);
  }
  return { description, inputSchema, name };
};

const readNativeResult = (reply: NativeReply) => {
  const content = reply.output?.content;
  if (!Array.isArray(content) || content.length !== 1) {
    throw new Error("The native tool did not return exactly one content item.");
  }
  const [item] = content;
  if (
    !isRecord(item) ||
    item.type !== "text" ||
    typeof item.text !== "string"
  ) {
    throw new Error("The native tool did not return a text item.");
  }
  const parsed: unknown = JSON.parse(item.text);
  return parsed;
};

test("the external bridge and native WebMCP share draft access and undo", async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const nativeTools = new Map<string, NativeTool>();
  const nativeReplies = new Map<string, NativeReply>();
  cdp.on("WebMCP.toolsAdded", ({ tools }: { tools: NativeTool[] }) => {
    for (const tool of tools) {
      nativeTools.set(tool.name, tool);
    }
  });
  cdp.on(
    "WebMCP.toolsRemoved",
    ({ tools }: { tools: RemovedNativeTool[] }) => {
      for (const tool of tools) {
        const current = nativeTools.get(tool.name);
        if (
          current?.frameId === tool.frameId &&
          current.toolId === tool.toolId
        ) {
          nativeTools.delete(tool.name);
        }
      }
    },
  );
  cdp.on("WebMCP.toolResponded", (reply: NativeReply) => {
    nativeReplies.set(reply.invocationId, reply);
  });
  await cdp.send("WebMCP.enable");

  await page.goto("/");
  const draft = page.getByRole("textbox", { name: "Ask Agent" });
  await draft.fill(initialDraft);
  await page.getByText("Agent connections", { exact: true }).click();
  const grant = page.getByRole("checkbox", {
    name: "Allow agents to edit the draft",
  });
  await expect(grant).toBeEnabled();
  await expect(grant).not.toBeChecked();
  await expect(page.getByText("WebMCP ready", { exact: true })).toBeVisible();

  const child = spawn(
    process.execPath,
    [bridgeScript, new URL(page.url()).origin],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  const messages: JsonRecord[] = [];
  const outputErrors: string[] = [];
  let stdinError = "";
  let stderr = "";
  let spawnError = "";
  child.on("error", (error: Error) => {
    spawnError = error.message;
  });
  child.stdin.on("error", (error: Error) => {
    stdinError = error.message;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (line.trim() === "") {
      return;
    }
    try {
      const message: unknown = JSON.parse(line);
      if (isRecord(message)) {
        messages.push(message);
      } else {
        outputErrors.push(`non-object message: ${line}`);
      }
    } catch {
      outputErrors.push(`invalid message: ${line}`);
    }
  });

  const bridgeFailure = () => {
    const details = [stderr, spawnError, outputErrors.join("; "), stdinError]
      .filter((part) => part !== "")
      .join(" ");
    return details === ""
      ? "The bridge process is not running."
      : `The bridge process is not running. ${details}`;
  };
  const bridgeExited = () =>
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.stdin.destroyed ||
    stdinError !== "";

  let nextRequestId = 0;
  const bridgeRequest = async (request: JsonRecord) => {
    if (bridgeExited()) {
      throw new Error(bridgeFailure());
    }
    const requestId = ++nextRequestId;
    child.stdin.write(`${JSON.stringify({ id: requestId, ...request })}\n`);
    await expect
      .poll(
        () => {
          if (bridgeExited()) {
            throw new Error(bridgeFailure());
          }
          return (
            messages.find((message) => message.id === requestId) ?? null
          );
        },
        { timeout: 10_000 },
      )
      .not.toBeNull();
    const message = messages.find((candidate) => candidate.id === requestId);
    if (!message) {
      throw new Error(`The bridge did not answer request ${requestId}.`);
    }
    return message.result;
  };
  const bridgeCall = (name: string, input: JsonRecord) =>
    bridgeRequest({ arguments: input, method: "tools/call", name });
  const nativeCall = async (
    name: string,
    input: Record<string, string>,
    refused = false,
  ) => {
    const tool = nativeTools.get(name);
    if (!tool) {
      throw new Error(`Chromium did not discover ${name}.`);
    }
    const { frameId, toolId } = tool;
    const { invocationId } = await cdp.send("WebMCP.invokeTool", {
      frameId,
      input,
      toolId,
    });
    await expect
      .poll(() => nativeReplies.has(invocationId), { timeout: 10_000 })
      .toBe(true);
    const reply = nativeReplies.get(invocationId);
    if (!reply) {
      throw new Error(`Chromium did not respond to ${name}.`);
    }
    expect(reply.status).toBe("Completed");
    expect(reply.output?.isError).toBe(refused);
    return readNativeResult(reply);
  };
  const transports: ToolCall[] = [bridgeCall, nativeCall];

  try {
    await expect
      .poll(() => [...nativeTools.keys()].sort(), { timeout: 10_000 })
      .toEqual([setName, undoName]);
    const nativeDefinitions = [setName, undoName].map((name) => {
      const tool = nativeTools.get(name);
      if (
        !tool ||
        tool.name !== name ||
        typeof tool.description !== "string" ||
        !isRecord(tool.inputSchema)
      ) {
        throw new Error(
          `Chromium returned an incomplete definition for ${name}.`,
        );
      }
      expect(tool.frameId).not.toBe("");
      expect(tool.toolId).not.toBe("");
      return {
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name,
      };
    });

    await expect
      .poll(
        () => {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(bridgeFailure());
          }
          return messages.find((message) => message.type === "ready")?.url;
        },
        { timeout: 15_000 },
      )
      .toMatch(bridgeUrlPattern);
    const ready = messages.find((message) => message.type === "ready");
    if (!ready || typeof ready.url !== "string") {
      throw new Error("The bridge did not publish its URL.");
    }
    await page.getByLabel("Bridge URL").fill(ready.url);
    await page.getByRole("button", { name: "Connect bridge" }).click();
    await expect(
      page.getByText("Bridge connected", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => messages.some((message) => message.type === "connected"), {
        timeout: 10_000,
      })
      .toBe(true);

    const listed = await bridgeRequest({ method: "tools/list" });
    if (!Array.isArray(listed)) {
      throw new Error("The bridge did not return a tool list.");
    }
    const bridgeTools = listed.map(readBridgeTool);
    expect(bridgeTools).toHaveLength(2);
    for (const definition of nativeDefinitions) {
      const bridgeTool = bridgeTools.find(
        (tool) => tool.name === definition.name,
      );
      if (!bridgeTool) {
        throw new Error(`The bridge did not list ${definition.name}.`);
      }
      expect(bridgeTool.description).not.toBe("");
      expect(bridgeTool.inputSchema).toStrictEqual(definition.inputSchema);
    }

    expect(await bridgeCall(setName, setArguments)).toStrictEqual(denied);
    await expect(draft).toHaveValue(initialDraft);
    expect(await nativeCall(setName, setArguments, true)).toStrictEqual(
      denied,
    );
    await expect(draft).toHaveValue(initialDraft);

    await grant.check();
    expect(await bridgeCall(setName, overLimitArguments)).toStrictEqual(
      invalidArguments,
    );
    await expect(draft).toHaveValue(initialDraft);
    expect(await nativeCall(setName, overLimitArguments, true)).toStrictEqual(
      invalidArguments,
    );
    await expect(draft).toHaveValue(initialDraft);
    expect(nativeTools.get(setName)?.inputSchema).toMatchObject({
      properties: { value: { maxLength: draftCodePointLimit } },
    });
    for (const call of transports) {
      expect(await call(setName, { value: limitDraft })).toStrictEqual(changed);
      await expect(draft).toHaveValue(limitDraft);
      expect(await call(undoName, {})).toStrictEqual(changed);
      await expect(draft).toHaveValue(initialDraft);
    }

    for (const call of transports) {
      expect(await call(setName, setArguments)).toStrictEqual(changed);
      await expect(draft).toBeVisible();
      await expect(draft).toHaveValue(agentDraft);
      expect(await call(undoName, {})).toStrictEqual(changed);
      await expect(draft).toBeVisible();
      await expect(draft).toHaveValue(initialDraft);
    }

    const multilineClients: [ToolCall, ToolCall][] = [
      [bridgeCall, nativeCall],
      [nativeCall, bridgeCall],
    ];
    // A draft sent with CRLF or bare CR must land as LF, so the same text from
    // the other client is a no-op and the undo slot still restores the baseline.
    for (const [sender, peer] of multilineClients) {
      expect(await sender(setName, multilineArguments)).toStrictEqual(
        changed,
      );
      await expect(draft).toHaveValue(multilineLfDraft);
      expect(await peer(setName, multilineLfArguments)).toStrictEqual(
        unchanged,
      );
      await expect(draft).toHaveValue(multilineLfDraft);
      expect(await peer(undoName, {})).toStrictEqual(changed);
      await expect(draft).toHaveValue(initialDraft);
    }

    expect(await nativeCall(setName, setArguments)).toStrictEqual(changed);
    await expect(draft).toHaveValue(agentDraft);
    await draft.fill(manualDraft);
    for (const call of transports) {
      expect(await call(undoName, {})).toStrictEqual(unchanged);
      await expect(draft).toHaveValue(manualDraft);
    }
    await draft.fill(initialDraft);

    expect(await bridgeCall(setName, setArguments)).toStrictEqual(changed);
    await expect(draft).toHaveValue(agentDraft);
    await grant.uncheck();
    expect(await bridgeCall(undoName, {})).toStrictEqual(denied);
    await expect(draft).toHaveValue(agentDraft);
    expect(await nativeCall(undoName, {}, true)).toStrictEqual(denied);
    await expect(draft).toHaveValue(agentDraft);
    await grant.check();
    expect(await nativeCall(undoName, {})).toStrictEqual(changed);
    await expect(draft).toHaveValue(initialDraft);

    await grant.uncheck();
    expect(await bridgeCall(setName, setArguments)).toStrictEqual(denied);
    await expect(draft).toHaveValue(initialDraft);
    expect(await nativeCall(setName, setArguments, true)).toStrictEqual(
      denied,
    );
    await expect(draft).toHaveValue(initialDraft);
  } finally {
    lines.close();
    if (!child.stdin.destroyed) {
      child.stdin.end();
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await closed;
    await cdp.detach();
  }
});
