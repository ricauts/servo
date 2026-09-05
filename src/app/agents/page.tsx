import { ChevronRight, Lock } from "lucide-react";
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

const NUM = "px-4 py-2 text-right font-mono text-[12px] tabular-nums";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ agent?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  const params = (await searchParams) ?? {};
  const initialAgent = typeof params.agent === "string" ? params.agent : undefined;
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
  const totals = usageRows.reduce(
    (acc, row) => ({
      calls: acc.calls + row.calls,
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0 },
  );

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

      {/* Fleet throughput sits above the rail as a collapsible band: the
          totals read from the closed summary, the per-key breakdown opens
          on demand so the rail stays at the top of the page. */}
      {usageRows.length > 0 && (
        <div className="px-4 pt-4 md:px-6 md:pt-6">
          <details className="group overflow-hidden rounded-lg border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 select-none [&::-webkit-details-marker]:hidden">
              <ChevronRight
                size={14}
                aria-hidden
                className="shrink-0 text-text-faint transition-transform group-open:rotate-90"
              />
              <span className="font-mono text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Throughput — last 7 days
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-x-3 font-mono text-[12px] text-muted-foreground tabular-nums">
                <span>
                  <span className="text-text-strong">{totals.calls.toLocaleString()}</span>{" "}
                  calls
                </span>
                <span>
                  <span className="text-text-strong">{totals.inputTokens.toLocaleString()}</span>{" "}
                  in
                </span>
                <span>
                  <span className="text-text-strong">{totals.outputTokens.toLocaleString()}</span>{" "}
                  out
                </span>
              </span>
            </summary>
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full font-sans text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10.5px] tracking-[0.14em] text-text-faint uppercase">
                    <th className="px-4 py-2 font-medium">Agent</th>
                    <th className="px-4 py-2 font-medium">API key</th>
                    <th className="px-4 py-2 font-medium">Model</th>
                    <th className="px-4 py-2 text-right font-medium">Calls</th>
                    <th className="px-4 py-2 text-right font-medium">Tokens in</th>
                    <th className="px-4 py-2 text-right font-medium">Tokens out</th>
                    <th className="px-4 py-2 text-right font-medium">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {usageRows.map((row) => (
                    <tr
                      key={`${row.agentName}-${row.credentialName}-${row.model}`}
                      className="border-t border-border"
                    >
                      <td className="px-4 py-2 text-text-strong">{row.agentName}</td>
                      <td className="px-4 py-2 font-mono text-[12px]">
                        {row.credentialName}
                      </td>
                      <td className="px-4 py-2 font-mono text-[12px] text-muted-foreground">
                        {row.model}
                      </td>
                      <td className={NUM}>{row.calls.toLocaleString()}</td>
                      <td className={NUM}>{row.inputTokens.toLocaleString()}</td>
                      <td className={NUM}>{row.outputTokens.toLocaleString()}</td>
                      <td className={NUM}>{row.avgLatencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      <AgentsManager
        profiles={views}
        toolCatalog={toolCatalog}
        credentials={credentials}
        canManage={can(user, "agents.manage")}
        initialSlug={initialAgent}
      />
    </>
  );
}
