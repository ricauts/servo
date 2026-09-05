"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Blocks, Search, X } from "lucide-react";
import { CATEGORY_LABEL, type PackCategory } from "@/lib/packs/catalog";
import type { BundleItem, BundleView, PackView, PacksResponse } from "@/lib/packs/state";
import { Chip, chipClass, packStateTone } from "@/components/kb/KbChip";
import { BTN_OUTLINE_SM, INPUT, LABEL, NOTE_CRITICAL, SEGMENT_GROUP, SELECT, segmentClass } from "@/components/kb/kb-controls";

const CATEGORIES = ["all", "sources", "extraction", "models", "identity", "tools", "bundles"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

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
      {/* One 32px control row: search, category, the install-state counts as chips. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="packs-filters">
        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connectors, tools, data types…"
            aria-label="Search packs"
            className={`${INPUT} pl-7 pr-7`}
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
        {/* Seven segments need ~640px; below md the same choice is a select,
            so nothing wraps into a clipped second row. */}
        <div role="group" aria-label="Category" className={`${SEGMENT_GROUP} max-md:hidden`}>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={segmentClass(category === c)}>
              {c === "all" ? "All" : CATEGORY_LABEL[c as PackCategory]}
            </button>
          ))}
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value as CategoryFilter)} aria-label="Category" className={`${SELECT} md:hidden`}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c === "all" ? "All" : CATEGORY_LABEL[c as PackCategory]}</option>
          ))}
        </select>
        <span className="flex items-center gap-1" aria-label="Install state">
          <Chip tone={packStateTone("configured")} caps>{counts.configured} configured</Chip>
          <Chip tone={packStateTone("available")} caps>{counts.available} available</Chip>
          <Chip tone={packStateTone("planned")} caps>{counts.planned} planned</Chip>
        </span>
      </div>

      {packs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="packs-grid">
          {packs.map((p) => {
            const planned = p.state === "planned";
            return (
              <article
                key={p.id}
                className={`flex flex-col overflow-hidden rounded-lg border border-border ${planned ? "bg-(--surface-2) text-(--text-muted)" : "bg-card text-foreground"}`}
                data-pack={p.id}
                data-state={p.state}
              >
                {/* Header: category in mono caps, the name, the state chip. */}
                <header className="flex items-start justify-between gap-2 px-4 pt-3.5">
                  <div className="min-w-0">
                    <p className={LABEL}>{CATEGORY_LABEL[p.category]}</p>
                    <h3 className={`mt-0.5 font-heading text-[14px] font-semibold leading-tight ${planned ? "text-(--text-muted)" : "text-foreground"}`}>{p.name}</h3>
                  </div>
                  <Chip tone={packStateTone(p.state)} caps>{p.state}</Chip>
                </header>
                <div className="flex flex-1 flex-col gap-2 px-4 py-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                  {p.detail && <p className="font-mono text-[11px]">{p.detail}</p>}
                  {(p.dataTypes?.length ?? 0) > 0 && (
                    <div className="mt-auto flex flex-wrap gap-1 pt-1" aria-label="Data types">
                      {p.dataTypes!.map((t) => (
                        <Chip key={t} tone="neutral" caps>{t}</Chip>
                      ))}
                    </div>
                  )}
                </div>
                {/* Footer: the one action, and where the docs live. */}
                <footer className={`flex items-center gap-2 border-t border-border px-4 py-2 ${planned ? "" : "bg-(--surface-2)"}`}>
                  {p.href && !planned && (
                    <Link href={p.href} className={BTN_OUTLINE_SM}>
                      {p.state === "configured" ? "Manage" : "Set up"} <ArrowUpRight size={11} />
                    </Link>
                  )}
                  {planned && <span className="font-mono text-[10.5px] text-muted-foreground">Not installable yet.</span>}
                  {p.docs && <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{p.docs}</span>}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {showBundles && (
        <section className="mt-2" data-testid="packs-bundles">
          <h2 className={`${LABEL} inline-flex items-center gap-1.5`}>
            <Blocks size={12} /> Bundles · local plugins
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            A bundle is a directory under <code className="font-mono">plugins/</code> with a <code className="font-mono">.claude-plugin/plugin.json</code>,
            shipping skills, agent profiles and MCP server entries. Placing the directory and restarting is the install; everything arrives
            disabled and an admin promotes items one by one. Fetching bundles from elsewhere is on the roadmap, not here.
          </p>
          {note && <p className={`${NOTE_CRITICAL} mt-2`}>{note}</p>}
          {initial.bundles.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No bundles on this install.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {initial.bundles.map((b: BundleView) => (
                <article key={b.id} className="overflow-hidden rounded-lg border border-border bg-card" data-bundle={b.name}>
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-(--surface-2) px-4 py-2.5">
                    <h3 className="font-heading text-[14px] font-semibold">{b.name}</h3>
                    <span className="font-mono text-[10.5px] text-muted-foreground">{b.enabledCount} of {b.items.length} enabled</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {b.items.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                        <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{item.kind}</span>
                        <span className="min-w-0 flex-1 truncate" title={item.slug}>{item.name}</span>
                        {canManage ? (
                          <button
                            type="button"
                            disabled={busy === item.id}
                            aria-pressed={item.enabled}
                            onClick={() => void toggle(item)}
                            className={`${chipClass(item.enabled ? "brand" : "neutral", { caps: true })} transition-colors hover:border-(--line-strong) disabled:opacity-50`}
                          >
                            {item.enabled ? "enabled" : "disabled"}
                          </button>
                        ) : (
                          <Chip tone={item.enabled ? "brand" : "neutral"} caps>{item.enabled ? "enabled" : "disabled"}</Chip>
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
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">Nothing matches.</p>
      )}
    </div>
  );
}
