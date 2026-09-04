// What is configured on THIS install (kb-lib-5): the catalog entries merged
// with counts and switches read from the database, plus the local plugin
// bundles syncPlugins() registered (origin "plugin:<name>") with their
// items and enabled flags. Read-only: every write stays with the routes
// that own the rows (skills, agents, mcp-servers, sources, settings).

import { db } from "@/lib/db";
import { getAiSettings } from "@/lib/ai/settings";
import { getEmbedSettings } from "@/lib/kb/embed";
import { getEnrichSettings } from "@/lib/kb/enrich";
import { getDoclingConfig } from "@/lib/kb/settings";
import { getSmtpConfig } from "@/lib/notify";
import { getInboundConfig } from "@/lib/inbound-email";
import { getGithubConfig } from "@/lib/integrations/github";
import { azureConfigured, getAzureConfig } from "@/lib/integrations/azure";
import { CATALOG, type CatalogEntry } from "./catalog";

export interface PackState {
  /** "configured" = in use here; "available" = shippable, nothing set yet;
   *  "planned" = named in the catalog, not built. */
  state: "configured" | "available" | "planned";
  /** A short line under the name: "2 sources", "provider zai · glm-5.3"… */
  detail: string;
}

export type PackView = CatalogEntry & PackState;

export interface BundleItem {
  kind: "skill" | "profile" | "server";
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
}

/** A local plugin bundle as syncPlugins() left it. */
export interface BundleView {
  id: string; // "bundle:<plugin name>"
  name: string;
  items: BundleItem[];
  enabledCount: number;
}

export interface PacksResponse {
  packs: PackView[];
  bundles: BundleView[];
}

/** The SSO switch, read the way getAuthConfig() reads it (env first, then
 *  the auth.oidc.* rows) — without importing the next-auth module, which
 *  cannot load outside Next's runtime and would tie this read-only summary
 *  to it. The secret is only ever tested for presence. */
async function oidcState(): Promise<{ mode: "oidc" | "demo"; label: string }> {
  const rows = await db.setting.findMany({
    where: { key: { in: ["auth.oidc.issuer", "auth.oidc.clientId", "auth.oidc.clientSecret", "auth.oidc.providerName"] } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const issuer = process.env.OIDC_ISSUER || map.get("auth.oidc.issuer") || "";
  const clientId = process.env.OIDC_CLIENT_ID || map.get("auth.oidc.clientId") || "";
  const secret = process.env.OIDC_CLIENT_SECRET || map.get("auth.oidc.clientSecret") || "";
  const providerName = process.env.OIDC_PROVIDER_NAME || map.get("auth.oidc.providerName") || "";
  return {
    mode: issuer && clientId && secret ? "oidc" : "demo",
    label: providerName || issuer,
  };
}

export async function packsState(): Promise<PacksResponse> {
  const [
    sourcesByKind,
    mcpServers,
    customTools,
    webhooks,
    ai,
    embed,
    enrich,
    docling,
    auth,
    smtp,
    inbound,
    github,
    azure,
    skills,
    profiles,
    pluginServers,
  ] = await Promise.all([
    db.dataSource.groupBy({ by: ["kind"], _count: { _all: true } }),
    db.mcpServer.count(),
    db.customTool.count(),
    db.webhook.count(),
    getAiSettings(),
    getEmbedSettings(),
    getEnrichSettings(),
    getDoclingConfig(db).catch(() => null),
    oidcState(),
    getSmtpConfig(),
    getInboundConfig(),
    getGithubConfig(),
    getAzureConfig(),
    db.skill.findMany({ where: { origin: { startsWith: "plugin:" } }, select: { id: true, slug: true, name: true, enabled: true, origin: true }, orderBy: { slug: "asc" } }),
    db.agentProfile.findMany({ where: { origin: { startsWith: "plugin:" } }, select: { id: true, slug: true, name: true, enabled: true, origin: true }, orderBy: { slug: "asc" } }),
    db.mcpServer.findMany({ where: { slug: { contains: "--" } }, select: { id: true, slug: true, name: true, enabled: true }, orderBy: { slug: "asc" } }),
  ]);

  const sourceCount = (kind: string) => sourcesByKind.find((r) => r.kind === kind)?._count._all ?? 0;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const configuredOr = (on: boolean, detail: string, fallback = "Not configured"): PackState => ({
    state: on ? "configured" : "available",
    detail: on ? detail : fallback,
  });

  const stateFor = (entry: CatalogEntry): PackState => {
    if (entry.status === "planned") return { state: "planned", detail: "Planned — not built yet" };
    switch (entry.id) {
      case "source-s3":
        return configuredOr(sourceCount("S3") > 0, plural(sourceCount("S3"), "source"));
      case "source-postgres":
        return configuredOr(sourceCount("POSTGRES") > 0, plural(sourceCount("POSTGRES"), "source"));
      case "extract-baseline":
        return { state: "configured", detail: "Always on — offline" };
      case "extract-docling":
        return configuredOr(Boolean(docling?.url), docling?.url ?? "");
      case "model-provider":
        return configuredOr(ai.provider !== "mock" && ai.keySource !== "none", `${ai.provider} · ${ai.model}`, "Mock mode — no key");
      case "model-embeddings":
        return configuredOr(embed.kind !== "none", embed.kind === "mock" ? "mock embedder" : `${embed.model}`);
      case "model-enrichment":
        return configuredOr(enrich.enabled, enrich.autoFile ? "On · auto-file" : "On", "Off");
      case "identity-oidc":
        return configuredOr(auth.mode === "oidc", auth.label, "Demo user switcher");
      case "mail-smtp":
        return configuredOr(smtp.enabled && smtp.urlSource !== "none", smtp.from || "SMTP relay set");
      case "mail-inbound":
        return configuredOr(inbound.enabled, "Webhook secret set");
      case "tool-github":
        return configuredOr(github.tokenSource !== "none", `token from ${github.tokenSource}`, "Simulated");
      case "tool-azure":
        return configuredOr(azureConfigured(azure), "Service principal set", "Simulated");
      case "tool-mcp":
        return configuredOr(mcpServers > 0, plural(mcpServers, "server"));
      case "tool-http":
        return configuredOr(customTools > 0, plural(customTools, "tool"));
      case "tool-webhooks":
        return configuredOr(webhooks > 0, plural(webhooks, "webhook"));
      default:
        return { state: "available", detail: "" };
    }
  };

  const packs: PackView[] = CATALOG.map((entry) => ({ ...entry, ...stateFor(entry) }));

  // Bundles: group plugin-origin rows by plugin name. An MCP server a
  // plugin shipped carries the "<plugin>--<slug>" naming (cnp-06) and no
  // origin column, so it is matched on the slug prefix.
  const byPlugin = new Map<string, BundleItem[]>();
  const push = (plugin: string, item: BundleItem) => {
    if (!byPlugin.has(plugin)) byPlugin.set(plugin, []);
    byPlugin.get(plugin)!.push(item);
  };
  for (const s of skills) push(s.origin.slice("plugin:".length), { kind: "skill", id: s.id, slug: s.slug, name: s.name, enabled: s.enabled });
  for (const p of profiles) push(p.origin.slice("plugin:".length), { kind: "profile", id: p.id, slug: p.slug, name: p.name, enabled: p.enabled });
  for (const m of pluginServers) {
    const plugin = m.slug.split("--")[0];
    if (byPlugin.has(plugin)) push(plugin, { kind: "server", id: m.id, slug: m.slug, name: m.name, enabled: m.enabled });
  }
  const bundles: BundleView[] = [...byPlugin.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => ({ id: `bundle:${name}`, name, items, enabledCount: items.filter((i) => i.enabled).length }));

  return { packs, bundles };
}
