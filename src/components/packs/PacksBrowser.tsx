"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Blocks, Search, X } from "lucide-react";
import { CATEGORY_LABEL, type PackCategory } from "@/lib/packs/catalog";
import type { BundleItem, BundleView, PackView, PacksResponse } from "@/lib/packs/state";

const CATEGORIES = ["all", "sources", "extraction", "models", "identity", "tools", "bundles"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

const STATE_STYLE: Record<PackView["state"], { label: string; tone: string; line: string }> = {
  configured: { label: "configured", tone: "var(--good-chip-ink)", line: "var(--good-chip-line)" },
  available: { label: "available", tone: "var(--text-muted)", line: "var(--line)" },
  planned: { label: "planned", tone: "var(--warn-chip-ink)", line: "var(--warn-chip-line)" },
};

/** Pure: the cards that survive the search and category filter. */
export function filterPacks(packs: readonly PackView[], query: string, category: CategoryFilter): PackView[] {
  const q = query.trim().toLowerCase();
  return packs.filter((p) => {
    if (category !== "all" && category !== "bundles" && p.category !== category) return false;
    if (category === "bundles") return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.includes(q)) ||
      (p.dataTypes ?? []).some((t) => t.toLowerCase().includes(q))
    );
  });
}

export default function PacksBrowser({ initial, canManage }: { initial: PacksResponse; canManage: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const packs = useMemo(() => filterPacks(initial.packs, query, category), [initial.packs, query, category]);
  const showBundles = category === "all" || category === "bundles";
  const counts = useMemo(() => {
    const c = { configured: 0, available: 0, planned: 0 };
    for (const p of initial.packs) c[p.state]++;
    return c;
  }, [initial.packs]);

  async function toggle(item: BundleItem) {
    const path = item.kind === "skill" ? `/api/skills/${item.id}` : item.kind === "profile" ? `/api/agents/${item.id}` : `/api/mcp-servers/${item.id}`;
    setBusy(item.id);
    setNote(null);
    try {
      const res = await fetch(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Change failed.");
      router.refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Change failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="packs-filters">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connectors, tools, data types…"
            aria-label="Search packs"
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-7 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
        <div role="group" aria-label="Category" className="flex flex-wrap overflow-hidden rounded-md border border-border">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`h-8 px-2.5 font-mono text-[10.5px] uppercase tracking-wider transition-colors ${category === c ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40"}`}
            >
              {c === "all" ? "All" : CATEGORY_LABEL[c as PackCategory]}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {counts.configured} configured · {counts.available} available · {counts.planned} planned
        </span>
      </div>

      {packs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="packs-grid">
          {packs.map((p) => {
            const style = STATE_STYLE[p.state];
            return (
              <article key={p.id} className="flex flex-col gap-2 rounded-md border border-border bg-card p-3.5" data-pack={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{CATEGORY_LABEL[p.category]}</p>
                    <h3 className="font-heading text-[14px] font-semibold leading-tight">{p.name}</h3>
                  </div>
                  <span className="shrink-0 rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4" style={{ color: style.tone, borderColor: style.line }}>
                    {style.label}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                {p.detail && <p className="font-mono text-[11px]">{p.detail}</p>}
                {(p.dataTypes?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.dataTypes!.map((t) => (
                      <span key={t} className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t}</span>
                    ))}
                  </div>
                )}
                <div className="mt-auto flex items-center gap-2 pt-1">
                  {p.href && p.state !== "planned" && (
                    <Link href={p.href} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-heading text-[11.5px] font-medium hover:bg-accent/40">
                      {p.state === "configured" ? "Manage" : "Set up"} <ArrowUpRight size={11} />
                    </Link>
                  )}
                  {p.state === "planned" && <span className="text-[11px] text-muted-foreground">Not installable yet.</span>}
                  {p.docs && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{p.docs}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showBundles && (
        <section className="mt-2" data-testid="packs-bundles">
          <h2 className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            <Blocks size={12} /> Bundles · local plugins
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            A bundle is a directory under <code className="font-mono">plugins/</code> with a <code className="font-mono">.claude-plugin/plugin.json</code>,
            shipping skills, agent profiles and MCP server entries. Placing the directory and restarting is the install; everything arrives
            disabled and an admin promotes items one by one. Fetching bundles from elsewhere is on the roadmap, not here.
          </p>
          {note && <p className="mt-2 text-xs" style={{ color: "var(--critical-chip-ink)" }}>{note}</p>}
          {initial.bundles.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No bundles on this install.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {initial.bundles.map((b: BundleView) => (
                <article key={b.id} className="rounded-md border border-border bg-card p-3.5" data-bundle={b.name}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-heading text-[14px] font-semibold">{b.name}</h3>
                    <span className="font-mono text-[10.5px] text-muted-foreground">{b.enabledCount} of {b.items.length} enabled</span>
                  </div>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {b.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 text-xs">
                        <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{item.kind}</span>
                        <span className="min-w-0 flex-1 truncate" title={item.slug}>{item.name}</span>
                        {canManage ? (
                          <button
                            type="button"
                            disabled={busy === item.id}
                            aria-pressed={item.enabled}
                            onClick={() => void toggle(item)}
                            className="rounded-full border px-2 py-px font-mono text-[10.5px] uppercase tracking-wider disabled:opacity-50"
                            style={{
                              borderColor: item.enabled ? "var(--brand-chip-line)" : "var(--line)",
                              background: item.enabled ? "var(--brand-chip)" : "transparent",
                              color: item.enabled ? "var(--brand-chip-ink)" : "var(--text-muted)",
                            }}
                          >
                            {item.enabled ? "enabled" : "disabled"}
                          </button>
                        ) : (
                          <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">{item.enabled ? "enabled" : "disabled"}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {packs.length === 0 && !showBundles && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Nothing matches.</p>
      )}
    </div>
  );
}
