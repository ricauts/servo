import {
  Blocks,
  KeyRound,
  Lock,
  Sparkles,
  Timer,
  Users,
  Wrench,
} from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAiSettings } from "@/lib/ai/settings";
import type { RiskLevel } from "@/lib/types";
import PageHeader from "@/components/shell/PageHeader";
import { Separator } from "@/components/ui/separator";
import Avatar from "@/components/common/Avatar";
import Badge from "@/components/common/Badge";
import EmptyState from "@/components/common/EmptyState";
import MasterDetail, {
  type MasterDetailItem,
} from "@/components/common/MasterDetail";
import type { BadgeTone } from "@/lib/labels";
import AiProviderForm, {
  type AiSettingsView,
} from "@/components/admin/AiProviderForm";
import ToolPolicyTable, {
  type ToolPolicyView,
} from "@/components/admin/ToolPolicyTable";
import CustomToolsManager, {
  type CustomToolView,
} from "@/components/admin/CustomToolsManager";
import { ensureSlaPolicies } from "@/lib/sla";
import RoleSelect from "@/components/admin/RoleSelect";
import CredentialsManager, {
  type CredentialView,
} from "@/components/admin/CredentialsManager";
import SlaPolicyTable, {
  type SlaPolicyView,
} from "@/components/admin/SlaPolicyTable";
import { PRIORITIES } from "@/lib/types";

export const dynamic = "force-dynamic";

const ROLE_TONE: Record<string, BadgeTone> = {
  ADMIN: "brand",
  AGENT: "good",
  REQUESTER: "neutral",
  AI_AGENT: "violet",
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ section?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  const params = (await searchParams) ?? {};
  const initialSection = typeof params.section === "string" ? params.section : undefined;

  if (user.role !== "ADMIN") {
    return (
      <>
        <PageHeader
          title="Settings"
          description="AI provider, tool permissions and team."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Admin access required"
            hint="Settings can only be managed by administrators. Use the user switcher at the bottom of the sidebar to switch to an admin account."
          />
        </div>
      </>
    );
  }

  await ensureSlaPolicies();
  const [ai, toolPolicies, customTools, users, slaPolicies] =
    await Promise.all([
      getAiSettings(),
      db.toolPolicy.findMany({ orderBy: { toolName: "asc" } }),
      db.customTool.findMany({ orderBy: { createdAt: "asc" } }),
      db.user.findMany({ orderBy: { createdAt: "asc" } }),
      db.slaPolicy.findMany(),
    ]);

  const credentialRows = await db.aiCredential.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { profiles: true } } },
  });
  const credentialViews: CredentialView[] = credentialRows.map((c) => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    model: c.model,
    baseUrl: c.baseUrl,
    inUse: c._count.profiles,
  }));

  const slaByPriority = new Map(slaPolicies.map((p) => [p.priority, p]));
  const slaViews: SlaPolicyView[] = PRIORITIES.flatMap((priority) => {
    const policy = slaByPriority.get(priority);
    return policy
      ? [
          {
            priority,
            responseMinutes: policy.responseMinutes,
            resolutionMinutes: policy.resolutionMinutes,
            escalateOnBreach: policy.escalateOnBreach,
          },
        ]
      : [];
  });

  const aiSettings: AiSettingsView = {
    provider: ai.configuredProvider,
    baseUrl: ai.baseUrl ?? "",
    model: ai.model,
    autoTriage: ai.autoTriage,
    autoDraft: ai.autoDraft,
    qaEnabled: ai.qaEnabled,
    apiKeySet: ai.apiKey.length > 0,
    keySource: ai.keySource,
    fallingBackToMock: ai.configuredProvider !== "mock" && ai.provider === "mock",
  };

  const policyViews: ToolPolicyView[] = toolPolicies.map((p) => ({
    toolName: p.toolName,
    description: p.description,
    riskLevel: p.riskLevel as RiskLevel,
    enabled: p.enabled,
    requiresApproval: p.requiresApproval,
  }));

  const policyByName = new Map(toolPolicies.map((p) => [p.toolName, p]));
  const customToolViews: CustomToolView[] = customTools.map((t) => {
    const policy = policyByName.get(t.name);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      method: t.method,
      url: t.url,
      headers: t.headers,
      bodyTemplate: t.bodyTemplate,
      secretSet: t.secret.length > 0,
      riskLevel: (policy?.riskLevel ?? "MEDIUM") as RiskLevel,
      requiresApproval: policy?.requiresApproval ?? true,
    };
  });

  // Rail statuses: the effective provider (mock when the key is unusable),
  // key-pool size, enabled/total tools, and the team size.
  const enabledTools = policyViews.filter((p) => p.enabled).length;
  const escalating = slaViews.filter((p) => p.escalateOnBreach).length;
  const providerStatus: MasterDetailItem["status"] =
    ai.provider === "mock"
      ? { label: "Mock", tone: aiSettings.fallingBackToMock ? "warn" : "neutral" }
      : { label: ai.provider, tone: "good" };

  const sections: MasterDetailItem[] = [
    {
      id: "ai",
      title: "AI provider",
      subtitle: "Bring your own key, model and automation",
      description:
        "Pick the provider and model every agent runs on. Keys can come from env vars or be stored encrypted; an unusable key falls back to mock so nothing breaks.",
      icon: <Sparkles size={16} />,
      status: providerStatus,
      keywords: ["byok", "anthropic", "openai", "zai", "mock", "model", "triage", "draft", "qa"],
      body: <AiProviderForm initial={aiSettings} />,
    },
    {
      id: "credentials",
      title: "API key pool",
      subtitle: "Named keys, one per specialist agent",
      description:
        "Register several named keys and assign one per specialist agent; the Agents page reports tokens and latency per key.",
      icon: <KeyRound size={16} />,
      status: {
        label: plural(credentialViews.length, "key"),
        tone: credentialViews.length > 0 ? "good" : "neutral",
      },
      keywords: ["credentials", "keys", "pool", "throughput"],
      body: <CredentialsManager credentials={credentialViews} />,
    },
    {
      id: "tools",
      title: "Tools",
      subtitle: "Enabled, risk level and approval per tool",
      description:
        "Per tool: enabled, risk level and whether it requires human approval. Approval gates on mutating tools are a security boundary.",
      icon: <Wrench size={16} />,
      status: {
        label: `${enabledTools}/${policyViews.length} tools`,
        tone: enabledTools > 0 ? "good" : "neutral",
      },
      keywords: ["permissions", "policy", "risk", "approval", ...policyViews.map((p) => p.toolName)],
      body: <ToolPolicyTable initialPolicies={policyViews} />,
    },
    {
      id: "custom-tools",
      title: "Custom tools",
      subtitle: "HTTP tools agents may call, behind the same gates",
      description:
        "Declare a tool as an HTTP call with a JSON schema; Servo's guarded runtime executes it behind the same risk and approval policy as the built-ins.",
      icon: <Blocks size={16} />,
      status:
        customToolViews.length > 0
          ? { label: plural(customToolViews.length, "tool"), tone: "good" }
          : { label: "None", tone: "neutral" },
      keywords: ["http", "integration", "webhook", "rest", "schema", ...customToolViews.map((t) => t.name)],
      body: <CustomToolsManager tools={customToolViews} />,
    },
    {
      id: "sla",
      title: "SLA",
      subtitle: "Response and resolution targets per priority",
      description:
        "Response and resolution targets per priority; a breach escalates the ticket a tier automatically when the scan runs (POST /api/sla/scan).",
      icon: <Timer size={16} />,
      status: {
        label: `${escalating}/${slaViews.length} escalate`,
        tone: escalating > 0 ? "good" : "neutral",
      },
      keywords: ["targets", "escalation", "breach", "priority", "response", "resolution"],
      body: <SlaPolicyTable initialPolicies={slaViews} />,
    },
    {
      id: "team",
      title: "Team",
      subtitle: "Roles for everyone who signs in",
      description:
        "Admins change team roles here; new SSO sign-ins start as REQUESTER and only ever see their own tickets.",
      icon: <Users size={16} />,
      status: { label: plural(users.length, "member"), tone: "neutral" },
      keywords: ["roles", "admin", "agent", "requester", ...users.map((u) => u.name)],
      body: (
        <div className="flex flex-col gap-3 font-sans">
          <ul className="flex flex-col divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-1 py-2.5">
                <Avatar
                  name={u.name}
                  color={u.color}
                  size={28}
                  isAi={u.role === "AI_AGENT"}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {u.name}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {u.email}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {u.role !== "AI_AGENT" && u.id !== user.id ? (
                    <RoleSelect userId={u.id} role={u.role} />
                  ) : (
                    <Badge tone={ROLE_TONE[u.role] ?? "neutral"}>
                      {u.role.replace("_", " ")}
                    </Badge>
                  )}
                  {u.role === "AI_AGENT" && u.aiKind && (
                    <Badge tone="neutral">{u.aiKind}</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Separator />
          <p className="font-body text-sm text-muted-foreground">
            Admins can change team roles here; new SSO sign-ins start as REQUESTER.
          </p>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configure the AI provider (bring your own key), tool permissions, SLA targets and review your team."
      />
      {/* One rail, one pane: every concern stays on one screen instead of
          one long scroll, and `?section=` keeps the place across visits. */}
      <MasterDetail
        title="Settings"
        param="section"
        initialId={initialSection}
        keepMounted
        items={sections}
      />
    </>
  );
}
