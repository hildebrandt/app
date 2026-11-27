import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { test as base } from "@playwright/test";

export type ChatMessageRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatMessageRole;
  content: string;
};

export type ChatChunk = {
  type: string;
  [key: string]: unknown;
};

export type ScenarioStep =
  | { type: "chunk"; chunk: ChatChunk }
  | { type: "hold" }
  | { type: "end" }
  | { type: "throw"; message?: string };

export type Scenario = {
  steps: ScenarioStep[];
};

export type RunState = {
  index: number;
  threadId: string | null;
  runId: string | null;
  messages: ChatMessage[];
  aborted: boolean;
  abortReason: string | null;
  status: string;
  terminal: "finished" | "error" | "eof" | null;
  holding: boolean;
  released: boolean;
  lateAttempted: boolean;
  ended: boolean;
  error: string | null;
};

export type PairState = {
  webUrl: string;
  scenariosRemaining: number;
  runs: RunState[];
};

export type ChatPair = {
  webUrl: string;
  control: ChatPairControl;
};

type ChatPairRuntime = ChatPair & {
  stop: () => Promise<void>;
};

export const chatChunk = {
  runStarted(threadId: string, runId: string): ChatChunk {
    return { type: "RUN_STARTED", threadId, runId, timestamp: Date.now() };
  },
  textStart(messageId: string, role: ChatMessageRole = "assistant"): ChatChunk {
    return {
      type: "TEXT_MESSAGE_START",
      messageId,
      role,
      timestamp: Date.now(),
    };
  },
  textDelta(messageId: string, delta: string): ChatChunk {
    return {
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta,
      timestamp: Date.now(),
    };
  },
  textEnd(messageId: string): ChatChunk {
    return { type: "TEXT_MESSAGE_END", messageId, timestamp: Date.now() };
  },
  runFinished(threadId: string, runId: string): ChatChunk {
    return { type: "RUN_FINISHED", threadId, runId, timestamp: Date.now() };
  },
  runError(threadId: string, runId: string, message: string): ChatChunk {
    return {
      type: "RUN_ERROR",
      threadId,
      runId,
      message,
      timestamp: Date.now(),
    };
  },
};

export function textMessageSteps(messageId: string, text: string): ScenarioStep[] {
  return [
    { type: "chunk", chunk: chatChunk.textStart(messageId) },
    { type: "chunk", chunk: chatChunk.textDelta(messageId, text) },
    { type: "chunk", chunk: chatChunk.textEnd(messageId) },
  ];
}

export function finishedTurn(
  threadId: string,
  runId: string,
  messageId: string,
  text: string,
): ScenarioStep[] {
  return [
    { type: "chunk", chunk: chatChunk.runStarted(threadId, runId) },
    ...textMessageSteps(messageId, text),
    { type: "chunk", chunk: chatChunk.runFinished(threadId, runId) },
  ];
}

export class ChatPairControl {
  readonly url: string;

  constructor(url: string) {
    this.url = url.replace(/\/$/, "");
  }

  async state(): Promise<PairState> {
    const response = await fetch(`${this.url}/state`);
    if (!response.ok) {
      throw new Error(
        `chat pair state failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as PairState;
  }

  async reset(scenarios: Scenario[]): Promise<PairState> {
    return await this.post<PairState>("/reset", { scenarios });
  }

  async release(run: number): Promise<PairState> {
    const result = await this.post<{ released: boolean; state: PairState }>(
      "/release",
      { run },
    );
    return result.state;
  }

  private async post<T>(pathname: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.url}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `chat pair ${pathname} failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as T;
  }
}

type Readiness = {
  webUrl: string;
  controlUrl: string;
};

async function waitForReadiness(
  child: ChildProcess,
): Promise<Readiness> {
  if (!child.stdout) {
    throw new Error("chat pair launcher has no stdout pipe");
  }
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const lines = createInterface({ input: child.stdout });
  return await new Promise<Readiness>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`chat pair did not start within 60s\n${stderr}`),
      );
    }, 60_000);

    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };

    child.once("error", fail);
    child.once("exit", (code, signal) => {
      fail(
        new Error(
          `chat pair exited before reporting readiness (code ${String(code)}, signal ${String(signal)})\n${stderr}`,
        ),
      );
    });

    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) {
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as Partial<Readiness>;
        if (
          typeof parsed.webUrl === "string" &&
          typeof parsed.controlUrl === "string"
        ) {
          clearTimeout(timer);
          resolve({
            webUrl: parsed.webUrl,
            controlUrl: parsed.controlUrl,
          });
        }
      } catch {
        // Ignore non-JSON output from the servers.
      }
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function startChatPair(): Promise<ChatPairRuntime> {
  const launcher = fileURLToPath(new URL("./chat-pair.mjs", import.meta.url));
  const child = spawn(process.execPath, [launcher], {
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let readiness: Readiness;
  try {
    readiness = await waitForReadiness(child);
  } catch (error) {
    await stopChild(child);
    throw error;
  }

  return {
    webUrl: readiness.webUrl,
    control: new ChatPairControl(readiness.controlUrl),
    stop: async () => {
      await stopChild(child);
    },
  };
}

type Fixtures = {
  chatPair: ChatPair;
};

export const test = base.extend<Fixtures>({
  chatPair: async ({ }, use) => {
    const externalControlUrl = process.env.CHAT_PAIR_CONTROL_URL?.trim();
    const externalWebUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();

    if (externalControlUrl) {
      if (!externalWebUrl) {
        throw new Error(
          "CHAT_PAIR_CONTROL_URL is set but PLAYWRIGHT_BASE_URL is not. " +
          "Set PLAYWRIGHT_BASE_URL to the webUrl printed by chat-pair.mjs.",
        );
      }
      await use({
        webUrl: externalWebUrl,
        control: new ChatPairControl(externalControlUrl),
      });
      return;
    }

    if (externalWebUrl) {
      throw new Error(
        "PLAYWRIGHT_BASE_URL is set without CHAT_PAIR_CONTROL_URL. " +
        "Start packages/e2e-web/e2e/fixtures/chat-pair.mjs, then set both " +
        "PLAYWRIGHT_BASE_URL (its webUrl) and CHAT_PAIR_CONTROL_URL (its controlUrl).",
      );
    }

    const pair = await startChatPair();
    try {
      await use(pair);
    } finally {
      await pair.stop();
    }
  },
});
