import { createFileRoute } from "@tanstack/react-router";

import { AgentWorkspace } from "./-agent-workspace";

export const Route = createFileRoute("/")({
  component: AgentWorkspace,
});
