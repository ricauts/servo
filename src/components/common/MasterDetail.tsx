"use client";

// MasterDetail — the desk's master-detail shell: a left rail listing every
// section with its icon, one-line subtitle and live status, one detail pane
// on the right. Selection is mirrored to the URL (`?<param>=<id>`) so deep
// links land on the right section and Back returns to it. Integrations and
// Settings render on it; Skills, Agents and Groups follow the same contract.
//
// Colour: every fill and ink below is a design-system token (`bg-(--brand-soft)`,
// `text-(--text-faint)`…) or a Tailwind utility mapped in globals.css — never
// a literal. The selected rail row is a quiet brand-soft surface with a 2px
// brand bar, not a filled pill; the status chip is the app's Badge.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Badge from "@/components/common/Badge";
import type { BadgeTone } from "@/lib/labels";
import { cn } from "@/lib/utils";

export interface MasterDetailItem {
  /** Stable id — becomes the `?<param>=` value, so keep it URL-safe. */
  id: string;
  title: string;
  /** One line under the title in the rail (truncated) and, unless
   *  `description` is given, the detail pane's description too. */
  subtitle?: string;
  /** Longer copy for the detail pane header; falls back to `subtitle`. */
  description?: ReactNode;
  /** A 16px lucide icon element, e.g. `<KeyRound size={16} />`. */
  icon?: ReactNode;
  /** Live status chip on the right of the rail row. */
  status?: { label: string; tone: BadgeTone };
  /** Extra search terms (the rail search also matches title + subtitle). */
  keywords?: string[];
  body: ReactNode;
}

export interface MasterDetailProps {
  items: MasterDetailItem[];
  /** The query-string key that mirrors the selection, e.g. `"section"`. */
  param: string;
  /** Server-resolved first selection (from the page's searchParams) so the
   *  server-rendered HTML already shows the right item. The live URL wins
   *  when both are present and valid; otherwise the first item. */
  initialId?: string;
  /** Rendered in the detail pane header, top-right. */
  actions?: ReactNode;
  /** Rendered in the pane when `items` is empty. */
  emptyState?: ReactNode;
  /** Render every body and hide the unselected ones (forms keep their
   *  state). Otherwise only the selected body mounts. */
  keepMounted?: boolean;
  /** Rail heading, accessible name and count noun ("Integrations" → "9
   *  integrations"). */
  title?: string;
}

/** The search box appears once the rail is long enough to need it. */
const SEARCH_THRESHOLD = 6;

function matches(item: MasterDetailItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [item.title, item.subtitle ?? "", ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function countLabel(visible: number, total: number, title?: string): string {
  let noun = (title ?? "items").toLowerCase();
  if (total === 1 && noun.endsWith("s")) noun = noun.slice(0, -1);
  return visible === total ? `${total} ${noun}` : `${visible} of ${total} ${noun}`;
}

export default function MasterDetail({
  items,
  param,
  initialId,
  actions,
  emptyState,
  keepMounted = false,
  title,
}: MasterDetailProps) {
  const searchParams = useSearchParams();
  const urlId = searchParams.get(param);
  const valid = (id: string | null | undefined) =>
    id && items.some((item) => item.id === id) ? id : undefined;
  const urlSelection = valid(urlId);

  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => urlSelection ?? valid(initialId) ?? items[0]?.id,
  );
  // Back/forward or a Link onto the same page with another section: follow
  // the URL. Clicks already set state before touching the URL, so this is a
  // no-op for them.
  useEffect(() => {
    if (urlSelection) setSelectedId(urlSelection);
  }, [urlSelection]);

  const [query, setQuery] = useState("");
  const showSearch = items.length > SEARCH_THRESHOLD;
  const visible = showSearch ? items.filter((item) => matches(item, query)) : items;
  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  const buttons = useRef(new Map<string, HTMLButtonElement>());

  function select(id: string) {
    setSelectedId(id);
    // Native replaceState is integrated with the App Router (it updates
    // useSearchParams) without re-rendering the page on the server — every
    // body is already here, so a rail click must not re-run the page's
    // queries. Other params survive.
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, id);
    window.history.replaceState(null, "", `?${next.toString()}`);
  }

  function onRailKeyDown(event: KeyboardEvent<HTMLElement>) {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if ((!forward && !backward) || visible.length === 0) return;
    event.preventDefault();
    const index = visible.findIndex((item) => item.id === selectedId);
    const nextIndex = forward
      ? Math.min(visible.length - 1, index + 1)
      : index === -1
        ? visible.length - 1
        : Math.max(0, index - 1);
    const next = visible[nextIndex]!;
    select(next.id);
    buttons.current.get(next.id)?.focus();
  }

  const railName = title ?? "Sections";

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:p-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
      {/* Rail: sticky at lg with its own scroll; a chip strip below it. The
          1-unit negative margin + padding keeps focus rings inside the
          scroll box instead of clipping them. */}
      <aside className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-5 lg:-m-1 lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto lg:p-1">
        {showSearch && (
          <label className="relative block">
            <span className="sr-only">Filter {railName.toLowerCase()}</span>
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-(--text-faint)"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Filter ${railName.toLowerCase()}…`}
              className="bg-card pl-8"
            />
          </label>
        )}

        <div className="flex items-center justify-between gap-2 px-1 font-mono text-[10.5px] tracking-[0.14em] text-(--text-faint) uppercase">
          <span className="truncate">{railName}</span>
          <span className="shrink-0 tabular-nums">
            {countLabel(visible.length, items.length, title)}
          </span>
        </div>

        <nav
          aria-label={railName}
          onKeyDown={onRailKeyDown}
          className="-m-1 flex flex-row gap-1 overflow-x-auto p-1 lg:m-0 lg:flex-col lg:overflow-x-visible lg:p-0"
        >
          {visible.map((item) => {
            const isSelected = item.id === selected?.id;
            return (
              <button
                key={item.id}
                type="button"
                ref={(node) => {
                  if (node) buttons.current.set(item.id, node);
                  else buttons.current.delete(item.id);
                }}
                onClick={() => select(item.id)}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "group relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:w-full",
                  isSelected
                    ? "bg-(--brand-soft) text-(--text-strong) before:absolute before:inset-x-3 before:bottom-0 before:h-0.5 before:rounded-full before:bg-(--brand) lg:before:inset-x-auto lg:before:top-2 lg:before:bottom-2 lg:before:left-0 lg:before:h-auto lg:before:w-0.5"
                    : "text-muted-foreground hover:bg-(--surface-hover) hover:text-(--text-strong)",
                )}
              >
                {item.icon && (
                  <span
                    aria-hidden
                    className={cn(
                      "flex shrink-0 [&_svg]:size-4 [&_svg]:shrink-0",
                      isSelected
                        ? "text-(--text-brand)"
                        : "text-(--text-faint) group-hover:text-muted-foreground",
                    )}
                  >
                    {item.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-heading text-[13px] font-semibold">
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span className="hidden truncate text-xs text-(--text-faint) lg:block">
                      {item.subtitle}
                    </span>
                  )}
                </span>
                {item.status && (
                  <Badge tone={item.status.tone} className="shrink-0">
                    {item.status.label}
                  </Badge>
                )}
              </button>
            );
          })}
          {visible.length === 0 && (
            <p className="px-3 py-2 font-mono text-[12.5px] text-(--text-faint)">
              No matches.
            </p>
          )}
        </nav>
      </aside>

      {/* Detail pane */}
      <Card className="min-w-0">
        {selected ? (
          <>
            <CardHeader className="border-b">
              <CardTitle className="font-heading text-lg font-semibold tracking-tight">
                {selected.title}
              </CardTitle>
              {(selected.description ?? selected.subtitle) && (
                <CardDescription className="max-w-2xl">
                  {selected.description ?? selected.subtitle}
                </CardDescription>
              )}
              {actions && <CardAction>{actions}</CardAction>}
            </CardHeader>
            <CardContent>
              {keepMounted
                ? items.map((item) => (
                    <div key={item.id} hidden={item.id !== selected.id}>
                      {item.body}
                    </div>
                  ))
                : selected.body}
            </CardContent>
          </>
        ) : (
          <CardContent>{emptyState}</CardContent>
        )}
      </Card>
    </div>
  );
}
