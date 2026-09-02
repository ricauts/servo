import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getToolRegistry } from "@/lib/ai/custom-tools";
import { CORE_TOOLS } from "@/lib/agent-profiles";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import AgentsManager, {
  type AgentProfileView,
  type ToolCatalogItem,
} from "@/components/agents/AgentsManager";
import type { RiskLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const user = await getCurrentUser();
  if (!can(user, "agents.view")) {
    return (
      <>
        <PageHeader
          title="Agents"
          description="Specialized resolver agents defined as .md documents."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Agent access required"
            hint="Only admins and agents can see the specialized agents. Switch users from the sidebar."
          />
        </div>
      </>
    );
  }

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [profiles, registry, policies, credentials, usage] = await Promise.all([
    db.agentProfile.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { runs: true } } },
    }),
    getToolRegistry(),
    db.toolPolicy.findMany(),
    db.aiCredential.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    db.aiUsage.groupBy({
      by: ["agentName", "credentialName", "model"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
      _avg: { latencyMs: true },
    }),
  ]);

  const views: AgentProfileView[] = profiles.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    categories: JSON.parse(p.categories) as string[],
    tools: JSON.parse(p.tools) as string[],
    markdown: p.markdown,
    enabled: p.enabled,
    credentialId: p.credentialId,
    runCount: p._count.runs,
  }));

  const usageRows = usage
    .map((row) => ({
      agentName: row.agentName,
      credentialName: row.credentialName,
      model: row.model,
      calls: row._count._all,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
      avgLatencyMs: Math.round(row._avg.latencyMs ?? 0),
    }))
    .sort((a, b) => b.calls - a.calls);

  // The tool catalog the picker offers: every enabled tool with its effective
  // risk/approval policy, core tools flagged (always granted, never toggled).
  const policyByName = new Map(policies.map((p) => [p.toolName, p]));
  const toolCatalog: ToolCatalogItem[] = Object.values(registry)
    .filter((t) => policyByName.get(t.name)?.enabled !== false)
    .map((t) => {
      const policy = policyByName.get(t.name);
      return {
        name: t.name,
        description: t.description,
        riskLevel: (policy?.riskLevel ?? "LOW") as RiskLevel,
        requiresApproval: policy?.requiresApproval ?? false,
        core: CORE_TOOLS.includes(t.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Agents"
        description="Specialized resolver personas defined in Markdown (frontmatter: name, categories, tools; body: system prompt). The resolver picks the enabled specialist covering the ticket's category."
      />
      <div className="space-y-4 p-4 md:p-8">
        {usageRows.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
            <div className="px-4 pt-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Throughput — last 7 days
            </div>
            <table className="w-full font-sans text-sm">
              <thead>
                <tr className="text-left font-heading text-xs text-muted-foreground">
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-4 py-2">API key</th>
                  <th className="px-4 py-2">Model</th>
                  <th className="px-4 py-2 text-right">Calls</th>
                  <th className="px-4 py-2 text-right">Tokens in</th>
                  <th className="px-4 py-2 text-right">Tokens out</th>
                  <th className="px-4 py-2 text-right">Avg latency</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.map((row) => (
                  <tr
                    key={`${row.agentName}-${row.credentialName}-${row.model}`}
                    className="border-t border-border"
                  >
                    <td className="px-4 py-2">{row.agentName}</td>
                    <td className="px-4 py-2 font-mono text-[12px]">
                      {row.credentialName}
                    </td>
                    <td className="px-4 py-2 font-mono text-[12px] text-muted-foreground">
                      {row.model}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-[12px]">
                      {row.calls}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-[12px]">
                      {row.inputTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-[12px]">
                      {row.outputTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-[12px]">
                      {row.avgLatencyMs} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AgentsManager
          profiles={views}
          toolCatalog={toolCatalog}
          credentials={credentials}
          canManage={can(user, "agents.manage")}
        />
      </div>
    </>
  );
}
