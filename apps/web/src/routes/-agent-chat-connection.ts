import { EventType } from "@tanstack/ai";
import { fetchServerSentEvents, type ConnectConnectionAdapter } from "@tanstack/ai-react";

export const interruptedMessage = "Response interrupted. Try again.";

const connection = fetchServerSentEvents("/api/chat");

export const chatConnection: ConnectConnectionAdapter = {
  async *connect(messages, data, signal, run) {
    let terminal = false;
    for await (const event of connection.connect(messages, data, signal, run)) {
      if (signal?.aborted) {
        return;
      }
      if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) {
        terminal = true;
      }
      yield event;
    }
    if (!terminal && !signal?.aborted) {
      throw new Error(interruptedMessage);
    }
  },
};
