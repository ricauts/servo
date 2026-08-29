// The built-in tool registry, assembled from one module per domain. Adding a
// tool = add it to its domain module (or a new one) + a default policy row in
// src/lib/ai/tool-policies.ts. Names must match the policy rows exactly.
//
// Import path stays `@/lib/ai/tools` — this index replaces the old monolith.

import { cloudTools } from "./cloud";
import { githubTools } from "./github";
import { historyTools } from "./history";
import { kbTools } from "./kb";
import { identityTools } from "./identity";
import { opsDbTools } from "./ops-db";
import { skillTools } from "./skills";
import { ticketTools } from "./ticket";
import { webTools } from "./web";

export type { ToolContext, ToolDef } from "./types";

export const TOOLS = {
  ...opsDbTools,
  ...historyTools,
  ...kbTools,
  ...identityTools,
  ...githubTools,
  ...cloudTools,
  ...webTools,
  ...skillTools,
  ...ticketTools,
};
