import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAuthConfig } from "@/lib/authjs";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/legacy/EmptyState";
import IntegrationsShell, {
  type IntegrationSection,
} from "@/components/admin/IntegrationsShell";
import SmtpForm, { type SmtpSettingsView } from "@/components/admin/SmtpForm";
import GithubForm, { type GithubSettingsView } from "@/components/admin/GithubForm";
import AzureForm, { type AzureSettingsView } from "@/components/admin/AzureForm";
import InboundEmailForm, {
  type InboundSettingsView,
} from "@/components/admin/InboundEmailForm";
import WebhooksManager, {
  type WebhookView,
} from "@/components/admin/WebhooksManager";
import AuthTenantForm, {
  type AuthTenantView,
} from "@/components/admin/AuthTenantForm";
import McpForm, { type McpSettingsView } from "@/components/admin/McpForm";
import McpServersManager, {
  type McpServerView,
} from "@/components/admin/McpServersManager";
import EgressForm, { type EgressSettingsView } from "@/components/admin/EgressForm";
import { getMcpConfig } from "@/lib/mcp";
import { mcpToolName, parseSnapshot } from "@/lib/mcp-client";
import { getEgressConfig } from "@/lib/egress";
import { getSmtpConfig } from "@/lib/notify";
import { getInboundConfig } from "@/lib/inbound-email";
import { getGithubConfig } from "@/lib/integrations/github";
import { azureConfigured, getAzureConfig } from "@/lib/integrations/azure";

export const dynamic = "force-dynamic";

/**
 * Integrations get their own surface: this list grows with every release
 * (SSO, email in/out, GitHub, Azure, webhooks…) and would drown Settings.
 */
export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (user.role !== "ADMIN") {
    return (
      <>
        <PageHeader
          title="Integrations"
          description="Connect Servo to your identity provider and systems."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Admin access required"
            hint="Integrations can only be managed by administrators."
          />
        </div>
      </>
    );
  }

  const [authConfig, smtp, inbound, github, azure, mcp, egress, webhookRows] = await Promise.all([
    getAuthConfig(),
    getSmtpConfig(),
    getInboundConfig(),
    getGithubConfig(),
    getAzureConfig(),
    getMcpConfig(),
    getEgressConfig(),
    db.webhook.findMany({
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const mcpServerRows = await db.mcpServer.findMany({ orderBy: { createdAt: "asc" } });

  const authView: AuthTenantView = {
    mode: authConfig.mode,
    issuer: authConfig.issuer,
    clientId: authConfig.clientId,
    providerName: authConfig.providerName,
    adminEmails: authConfig.adminEmails.join(", "),
    allowedDomains: authConfig.allowedDomains.join(", "),
    secretSet: authConfig.clientSecret.length > 0,
    secretSource: authConfig.secretSource,
  };
  const smtpSettings: SmtpSettingsView = {
    enabled: smtp.enabled,
    from: smtp.from,
    urlSet: smtp.url.length > 0,
    urlSource: smtp.urlSource,
  };
  const inboundSettings: InboundSettingsView = {
    enabled: inbound.enabled,
    secretSet: inbound.secret.length > 0,
    secretSource: inbound.secretSource,
  };
  const githubSettings: GithubSettingsView = {
    owner: github.owner,
    tokenSet: github.token.length > 0,
    tokenSource: github.tokenSource,
  };
  const azureSettings: AzureSettingsView = {
    tenantId: azure.tenantId,
    clientId: azure.clientId,
    subscriptionId: azure.subscriptionId,
    secretSet: azure.clientSecret.length > 0,
    secretSource: azure.secretSource,
    configured: azureConfigured(azure),
  };
  const mcpView: McpSettingsView = {
    tokenSet: mcp.token.length > 0,
    tokenSource: mcp.tokenSource,
  };
  const egressView: EgressSettingsView = { allowlist: egress.allowlist };
  // The secret never reaches the client: only secretSet crosses the boundary.
  const mcpServerViews: McpServerView[] = mcpServerRows.map((server) => ({
    id: server.id,
    slug: server.slug,
    name: server.name,
    transport: server.transport,
    url: server.url,
    enabled: server.enabled,
    secretSet: server.secret.length > 0,
    lastSyncAt: server.lastSyncAt ? server.lastSyncAt.toISOString() : null,
    tools: parseSnapshot(server.toolsJson).map((tool) => ({
      name: tool.name,
      policyName: mcpToolName(server.slug, tool.name),
      description: tool.description,
    })),
  }));
  const connectedServers = mcpServerViews.filter((s) => s.enabled).length;
  const webhookViews: WebhookView[] = webhookRows.map((hook) => ({
    id: hook.id,
    url: hook.url,
    events: JSON.parse(hook.events) as string[],
    enabled: hook.enabled,
    deliveries: hook.deliveries.map((d) => ({
      id: d.id,
      event: d.event,
      ok: d.ok,
      statusCode: d.statusCode,
      error: d.error,
      durationMs: d.durationMs,
    })),
  }));

  const activeWebhooks = webhookViews.filter((w) => w.enabled).length;
  const off = { label: "Off", tone: "neutral" as const };
  const sections: IntegrationSection[] = [
    {
      id: "sso",
      title: "Single sign-on",
      blurb:
        "Connect any OIDC identity provider (Google, Entra ID, Okta, Keycloak…). Without a tenant Servo stays in the offline demo mode.",
      status:
        authView.mode === "oidc" ? { label: "Active", tone: "good" } : { label: "Demo", tone: "warn" },
      body: <AuthTenantForm initial={authView} />,
    },
    {
      id: "smtp",
      title: "Email notifications",
      blurb:
        "Outbound mail over any SMTP server: ticket confirmations, resolutions, approval alerts and approved AI replies.",
      status: smtpSettings.enabled
        ? { label: "Active", tone: "good" }
        : smtpSettings.urlSet
          ? { label: "Paused", tone: "warn" }
          : off,
      body: <SmtpForm initial={smtpSettings} />,
    },
    {
      id: "inbound",
      title: "Inbound email",
      blurb:
        "Mail becomes tickets: point a provider webhook (or the bundled IMAP relay for Gmail) at POST /api/inbound/email.",
      status: inboundSettings.enabled
        ? { label: "Active", tone: "good" }
        : inboundSettings.secretSet
          ? { label: "Paused", tone: "warn" }
          : off,
      body: <InboundEmailForm initial={inboundSettings} />,
    },
    {
      id: "github",
      title: "GitHub",
      blurb:
        "Personal access token for real repository, branch and pull-request tools; without one they run simulated.",
      status: githubSettings.tokenSet ? { label: "Connected", tone: "good" } : off,
      body: <GithubForm initial={githubSettings} />,
    },
    {
      id: "azure",
      title: "Azure",
      blurb:
        "Read-only service principal (Reader role) for live Resource Manager queries; mutations stay simulated behind approvals.",
      status: azureSettings.configured ? { label: "Connected", tone: "good" } : off,
      body: <AzureForm initial={azureSettings} />,
    },
    {
      id: "webhooks",
      title: "Outbound webhooks",
      blurb:
        "Stream ticket, approval and reply events to any endpoint as HMAC-signed JSON, with a per-endpoint delivery log.",
      status:
        activeWebhooks > 0 ? { label: `${activeWebhooks} active`, tone: "good" } : off,
      body: <WebhooksManager webhooks={webhookViews} />,
    },
    {
      id: "egress",
      title: "Outbound web access",
      blurb:
        "Which hosts agents may open with fetch_url, take_screenshot and HTTP integrations. Private and link-local addresses are always refused unless named here.",
      status:
        egressView.allowlist.length > 0
          ? { label: `${egressView.allowlist.length} allowed`, tone: "good" as const }
          : { label: "Public web", tone: "brand" as const },
      body: <EgressForm initial={egressView} />,
    },
    {
      id: "mcp-connections",
      title: "MCP connections",
      blurb:
        "Servo as a Model Context Protocol client: connect an external MCP server and list its tools. Everything it offers arrives disabled, HIGH risk and approval-gated until an admin enables it.",
      status:
        connectedServers > 0
          ? { label: `${connectedServers} enabled`, tone: "good" as const }
          : mcpServerViews.length > 0
            ? { label: `${mcpServerViews.length} off`, tone: "warn" as const }
            : off,
      body: <McpServersManager servers={mcpServerViews} />,
    },
    {
      id: "mcp",
      title: "MCP server",
      blurb:
        "Servo as a Model Context Protocol server: external agents file and search tickets and operate the tool registry.",
      status: mcpView.tokenSet ? { label: "Active", tone: "good" } : off,
      body: <McpForm initial={mcpView} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect Servo to your identity provider, mail, code and cloud — every credential stays server-side and is never returned by the API."
      />
      <IntegrationsShell sections={sections} />
    </>
  );
}
