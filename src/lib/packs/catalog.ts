// The Packs catalog (kb-lib-5): what Servo can connect to, extract with,
// call and load — curated IN THE REPO, never fetched. docs/design/
// marketplace.md fixes the shape: the surface is "Packs" at /packs, the one
// install path for bundles is syncPlugins(), nothing here names or implies
// a registry, and every entry either exists in this tree today ("available")
// or is stated as planned ("planned") with no install affordance at all.
//
// This file is the pure half: the entries and their kinds. The state — what
// is configured on THIS install — is computed by state.ts from the database
// and merged into the same entry shape, so the page renders one list.

export type PackCategory = "sources" | "extraction" | "models" | "identity" | "tools" | "bundles";

export interface CatalogEntry {
  id: string;
  category: PackCategory;
  name: string;
  /** One sentence: what it connects, extracts or does. */
  description: string;
  /** Data types the graph and the tools see through it, when any. */
  dataTypes?: string[];
  status: "available" | "planned";
  /** Where the install/configure action lives in this app. Absent when planned. */
  href?: string;
  /** The docs page that explains the trust and credential model. */
  docs?: string;
  tags: string[];
}

export const CATEGORY_LABEL: Record<PackCategory, string> = {
  sources: "Data sources",
  extraction: "Extraction",
  models: "Models",
  identity: "Identity & mail",
  tools: "Tools & systems",
  bundles: "Bundles",
};

export const CATALOG: readonly CatalogEntry[] = [
  // --- Data sources: the DataSource model (xds-*) and the catalog (cat-*).
  {
    id: "source-s3",
    category: "sources",
    name: "S3 / object storage",
    description: "Crawl a bucket prefix into indexed records and catalog cards; the objects stay in the bucket.",
    dataTypes: ["S3"],
    status: "available",
    href: "/kb/sources",
    docs: "docs/knowledge-base.md",
    tags: ["aws", "minio", "object storage", "data lake"],
  },
  {
    id: "source-postgres",
    category: "sources",
    name: "PostgreSQL",
    description: "Index a schema or table read-only and describe its columns as catalog cards agents can cite.",
    dataTypes: ["POSTGRES"],
    status: "available",
    href: "/kb/sources",
    docs: "docs/knowledge-base.md",
    tags: ["sql", "warehouse", "database"],
  },
  {
    id: "source-azure-blob",
    category: "sources",
    name: "Azure Blob / Data Lake Gen2",
    description: "Crawl containers and hierarchical namespaces the way the S3 connector crawls a bucket.",
    dataTypes: ["AZURE_BLOB"],
    status: "planned",
    tags: ["azure", "data lake", "object storage"],
  },
  {
    id: "source-mysql",
    category: "sources",
    name: "MySQL / MariaDB",
    description: "The PostgreSQL connector's read-only indexing for MySQL-family databases.",
    dataTypes: ["MYSQL"],
    status: "planned",
    tags: ["sql", "database"],
  },
  {
    id: "source-bigquery",
    category: "sources",
    name: "Google BigQuery",
    description: "Catalog datasets and tables; query through the ops sandbox with a read-only service account.",
    dataTypes: ["BIGQUERY"],
    status: "planned",
    tags: ["gcp", "warehouse", "sql"],
  },
  {
    id: "source-sharepoint",
    category: "sources",
    name: "SharePoint / OneDrive",
    description: "Crawl document libraries into the knowledge base with the same visibility model as uploads.",
    dataTypes: ["SHAREPOINT"],
    status: "planned",
    tags: ["microsoft 365", "documents"],
  },
  {
    id: "source-google-drive",
    category: "sources",
    name: "Google Drive",
    description: "Crawl shared drives and folders into the knowledge base.",
    dataTypes: ["GOOGLE_DRIVE"],
    status: "planned",
    tags: ["google workspace", "documents"],
  },

  // --- Extraction lanes.
  {
    id: "extract-baseline",
    category: "extraction",
    name: "Built-in extractors",
    description: "PDF text layer, Excel workbooks, Word documents, Markdown and plain text — in the forked worker, offline.",
    status: "available",
    href: "/kb",
    docs: "docs/knowledge-base.md",
    tags: ["pdf", "xlsx", "docx", "markdown"],
  },
  {
    id: "extract-docling",
    category: "extraction",
    name: "Docling sidecar",
    description: "Layout-aware PDF extraction with OCR for scanned pages, run as a local container you point Servo at.",
    status: "available",
    href: "/kb",
    docs: "docs/KB-DOCLING.md",
    tags: ["ocr", "layout", "scanned"],
  },

  // --- Models.
  {
    id: "model-provider",
    category: "models",
    name: "Model provider",
    description: "Anthropic, any Anthropic- or OpenAI-compatible endpoint, or Z.AI GLM — one key, used by every agent.",
    status: "available",
    href: "/settings",
    docs: "README.md",
    tags: ["anthropic", "openai", "z.ai", "ollama", "vllm"],
  },
  {
    id: "model-embeddings",
    category: "models",
    name: "Embeddings endpoint",
    description: "Turns keyword-only retrieval into keyword + vector search; any OpenAI-compatible embeddings API.",
    status: "available",
    href: "/kb",
    docs: "docs/knowledge-base.md",
    tags: ["vector", "retrieval", "pgvector"],
  },
  {
    id: "model-enrichment",
    category: "models",
    name: "AI enrichment",
    description: "Topics, a summary in the document's language and a shelf per document — opt-in, sends content to the provider.",
    status: "available",
    href: "/kb",
    docs: "docs/knowledge-base.md",
    tags: ["topics", "library", "categories"],
  },

  // --- Identity & mail.
  {
    id: "identity-oidc",
    category: "identity",
    name: "Single sign-on (OIDC)",
    description: "Entra ID, Google, Okta, Keycloak, Auth0 — users provisioned on first sign-in, domains allowlisted.",
    status: "available",
    href: "/integrations?section=sso",
    docs: "README.md",
    tags: ["sso", "entra", "google", "okta"],
  },
  {
    id: "mail-smtp",
    category: "identity",
    name: "Outbound email (SMTP)",
    description: "Notifications and delivered replies through your own SMTP relay.",
    status: "available",
    href: "/integrations?section=smtp",
    docs: "docs/USER-GUIDE.md",
    tags: ["email", "notifications"],
  },
  {
    id: "mail-inbound",
    category: "identity",
    name: "Inbound email",
    description: "Mail becomes tickets — a provider webhook, or the bundled IMAP relay for Gmail and Workspace.",
    status: "available",
    href: "/integrations?section=inbound",
    docs: "docs/USER-GUIDE.md",
    tags: ["email", "imap", "gmail"],
  },

  // --- Tools & systems.
  {
    id: "tool-github",
    category: "tools",
    name: "GitHub",
    description: "Real repositories and pull requests from the resolver's github_* tools with a fine-grained token.",
    status: "available",
    href: "/integrations?section=github",
    docs: "docs/USER-GUIDE.md",
    tags: ["git", "pull requests"],
  },
  {
    id: "tool-azure",
    category: "tools",
    name: "Azure (read-only)",
    description: "azure_list_resources through a Reader-role service principal.",
    status: "available",
    href: "/integrations?section=azure",
    docs: "docs/USER-GUIDE.md",
    tags: ["cloud", "inventory"],
  },
  {
    id: "tool-mcp",
    category: "tools",
    name: "MCP servers",
    description: "Any Streamable HTTP MCP server; every imported tool arrives quarantined until an admin enables it.",
    status: "available",
    href: "/integrations?section=mcp-servers",
    docs: "docs/connectors.md",
    tags: ["mcp", "tools", "quarantine"],
  },
  {
    id: "tool-http",
    category: "tools",
    name: "HTTP tools",
    description: "Declare a tool as an HTTP call with a JSON schema; Servo's guarded runtime executes it.",
    status: "available",
    href: "/settings",
    docs: "docs/USER-GUIDE.md",
    tags: ["webhook", "rest", "custom tool"],
  },
  {
    id: "tool-webhooks",
    category: "tools",
    name: "Outbound webhooks",
    description: "Ticket and run events pushed to your systems with a sealed secret.",
    status: "available",
    href: "/integrations?section=webhooks",
    docs: "docs/USER-GUIDE.md",
    tags: ["events", "automation"],
  },
];

/** The words the catalog must never carry (docs/design/marketplace.md,
 *  Ruling 7 and the claims lint): the surface is local, and copy that hints
 *  at a registry or a service that does not exist is a false claim. */
export const FORBIDDEN_COPY = [/marketplace/i, /hosted/i, /registry/i, /sign[ -]?up/i];
