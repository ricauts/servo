// Default policy (risk level + approval requirement) for every built-in tool.
// Single source of truth shared by the seed and by ensureToolPolicies(), which
// backfills rows at runtime — so adding a built-in tool makes it available on
// upgrade without a destructive reseed. Admin edits are never overwritten.
//
// Dependency-free on purpose: prisma/seed.ts imports it directly.

export interface DefaultToolPolicy {
  toolName: string;
  description: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiresApproval: boolean;
}

export const DEFAULT_TOOL_POLICIES: DefaultToolPolicy[] = [
  {
    toolName: "query_ops_database",
    description: "Run read-only SQL (SELECT) against the connected database.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "execute_ops_sql",
    description:
      "Run mutating SQL (CREATE/ALTER/INSERT/UPDATE/DELETE/DROP) against the connected database.",
    riskLevel: "HIGH",
    requiresApproval: true,
  },
  {
    toolName: "get_device_info",
    description: "Look up a device in the asset inventory by asset tag.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "reset_password",
    description: "Reset a user's password and send a recovery link (simulated).",
    riskLevel: "MEDIUM",
    requiresApproval: false,
  },
  {
    toolName: "github_create_repo",
    description: "Create a new GitHub repository (real API when a token is configured).",
    riskLevel: "MEDIUM",
    requiresApproval: false,
  },
  {
    toolName: "github_create_branch",
    description:
      "Create a feature branch on an existing repository (real API when a token is configured).",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "github_open_pr",
    description: "Open a pull request with proposed changes (real API when a token is configured).",
    riskLevel: "MEDIUM",
    requiresApproval: false,
  },
  {
    toolName: "azure_list_resources",
    description:
      "List Azure resources in the configured subscription (read-only; real API when credentials are configured).",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "cloud_plan_deployment",
    description: "Generate an IaC deployment plan (Azure/AWS/GCP, simulated).",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "cloud_apply_deployment",
    description: "Apply a previously generated deployment plan (simulated).",
    riskLevel: "HIGH",
    requiresApproval: true,
  },
  {
    toolName: "post_comment",
    description: "Post a public comment on the ticket.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "resolve_ticket",
    description: "Mark the ticket as resolved with a resolution note.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "take_screenshot",
    description:
      "Render a web page in a real browser and attach the screenshot to the ticket for a human to review.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "fetch_url",
    description:
      "Read a public http(s) page as text (status pages, vendor docs, a link the requester sent). Internal addresses are refused unless allowlisted.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "github_list_repos",
    description: "List the GitHub repositories this install can reach (cached).",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "github_read_file",
    description: "Read a file from a GitHub repository to inspect the code before changing it.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "github_edit_file",
    description:
      "Commit a precise find/replace change to a file on a feature branch (real API when a token is configured).",
    riskLevel: "HIGH",
    requiresApproval: true,
  },
  {
    toolName: "github_merge_pr",
    description:
      "Merge an open pull request into its base branch, shipping the change and triggering deployment.",
    riskLevel: "HIGH",
    requiresApproval: true,
  },
  {
    toolName: "search_tickets",
    description:
      "Search past tickets on this desk and read how they were resolved, ranked by relevance.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "read_ticket",
    description:
      "Read one past ticket in full: the request, the replies sent, the tools used and the resolution.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "requester_history",
    description: "List the other tickets a requester has filed and how each one ended.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "read_skill",
    description:
      "Load one of this desk's agreed procedures (skills) in full before acting on a ticket it covers.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "search_knowledge",
    description: "Search the company knowledge base for cited passages (entitlement-filtered).",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "read_document",
    description: "Read one knowledge-base document, paginated by locator cursor.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "list_collections",
    description: "List knowledge-base collections with readable-document counts.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "find_sources",
    description: "Rank the readable datasets for a question and return short briefs.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "open_dataset",
    description: "Read one dataset's card section by section, with a cursor.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "discard_source",
    description: "Drop a dataset or source from consideration; returns the next candidates.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "query_dataset",
    description:
      "Run ONE read-only SQL statement against a dataset's silo. Every row crosses an approval gate first.",
    riskLevel: "HIGH",
    requiresApproval: true,
  },
  {
    toolName: "escalate_to_human",
    description:
      "Hand the ticket to a human teammate when the main objective could not be completed.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
];
