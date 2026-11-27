import type { DraftToolDefinition, DraftTools } from "./-agent-tools";

type NativeTool = DraftToolDefinition & {
  execute: (input: unknown) => Promise<{
    content: { type: "text"; text: string }[];
    isError: boolean;
  }>;
};
type ModelContext = {
  registerTool: (tool: NativeTool, options: { signal: AbortSignal }) => Promise<void>;
};

const bridgeUrlPattern = /^ws:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/[a-f0-9]{32}$/u;

export const resolveBridgeUrl = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || !bridgeUrlPattern.test(value)) {
    return null;
  }
  const url = URL.parse(value);
  return url?.href === value ? url.href : null;
};

export const registerDraftWebMcp = async (tools: DraftTools, signal: AbortSignal) => {
  const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (typeof modelContext?.registerTool !== "function") {
    return false;
  }

  await Promise.all(tools.list().map((tool) => modelContext.registerTool({
    ...tool,
    execute: async (input) => {
      const result = await tools.call(tool.name, input);
      return {
        content: [{ text: JSON.stringify(result), type: "text" }],
        isError: !result.ok,
      };
    },
  }, { signal })));
  return true;
};

const readRequest = (data: unknown): unknown => {
  if (typeof data !== "string") {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

export const handleBridgeMessage = async (socket: WebSocket, tools: DraftTools, data: unknown) => {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  const request = readRequest(data);
  if (typeof request !== "object" || request === null || !("id" in request) ||
    typeof request.id !== "number" || !Number.isSafeInteger(request.id) || !("method" in request)) {
    return;
  }
  const { id } = request;
  let result: unknown;
  if (request.method === "tools/list") {
    result = tools.list();
  } else if (request.method === "tools/call" && "name" in request && "arguments" in request) {
    result = await tools.call(request.name, request.arguments);
  } else {
    result = { error: "invalid_request", ok: false };
  }
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id, result }));
  }
};
