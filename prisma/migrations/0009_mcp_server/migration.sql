-- cnp-02: Servo as an MCP client. Numbered 0009 because dcl-01 landed
-- 0008_extractor_provenance while this branch sat in review; renumbered on
-- the merge so the history stays a monotonic sequence rather than two
-- directories sharing a number. One table, one unique index; nothing
-- existing is touched, so this is additive by the migration-guard's reading.
-- `enabled` defaults FALSE: a server is inert until an admin turns it on,
-- and its tools stay quarantined (enabled false / requiresApproval true /
-- riskLevel HIGH) in ToolPolicy regardless of the server's own flag.
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'http',
    "url" TEXT NOT NULL,
    "headers" TEXT NOT NULL DEFAULT '{}',
    "secret" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "toolsJson" TEXT NOT NULL DEFAULT '[]',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpServer_slug_key" ON "McpServer"("slug");
