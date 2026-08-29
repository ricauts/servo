// Shared contract for every Servo tool, built-in or custom. Domain modules
// under src/lib/ai/tools/ export Record<string, ToolDef> maps that index.ts
// assembles into the registry.
//
// Contract: tools never throw for expected failures — they return descriptive
// strings so the model (real or mock) can read the error and adapt; the
// engine still catches unexpected exceptions and converts them to error
// tool_results. Default risk/approval policies live in
// src/lib/ai/tool-policies.ts (dependency-free so the seed can import it).

import type { User } from "@prisma/client";

export interface ToolContext {
  ticketId: string;
  runId: string;
  agentUser: User;
  /** KB principal chain (kb-11): the agent principal intersected with the
   *  ticket requester. Absent on synthetic contexts (MCP) — KB tools deny. */
  principals?: { agentId: string; humanId: string | null };
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/** Cap tool results so a huge query cannot blow up the conversation. */
export const RESULT_LIMIT = 4000;

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
