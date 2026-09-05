"use client";

// Global ⌘K / Ctrl+K palette: jump to any page or find a ticket by number,
// title, or text. Ticket search hits /api/tickets?q= (debounced) so results
// stay fresh without shipping the queue to the client.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import Badge from "@/components/common/Badge";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import type { NavEntry } from "@/components/shell/nav-items";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/labels";
import type { TicketStatus } from "@/lib/types";

interface TicketHit {
  id: string;
  number: number;
  title: string;
  status: string;
}

// Group headings in the ds mono micro-label: 10.5px caps, 0.14em, faint ink.
const GROUP_LABEL =
  "**:[[cmdk-group-heading]]:font-mono **:[[cmdk-group-heading]]:text-[10.5px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.14em] **:[[cmdk-group-heading]]:text-text-faint";

export default function CommandPalette({ entries = [] }: { entries?: NavEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TicketHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(() => {
      fetch(`/api/tickets?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((data: { tickets?: TicketHit[] }) => {
          setHits((data.tickets ?? []).slice(0, 8));
        })
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 200);
  }, [query]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      router.push(href);
    },
    [router],
  );

  return (
    // The ds palette: a floating surface with a hairline and --shadow-3 (the
    // dialog's alpha ring is replaced by a real border), mono caps group
    // labels, mono ids.
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a page or search tickets"
      className="rounded-[10px]! border border-input shadow-lg ring-0"
    >
      {/* Ticket search is server-side; cmdk must not re-filter those hits away. */}
      <Command shouldFilter={false}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search tickets or jump to a page…"
        className="font-sans"
      />
      <CommandList>
        <CommandEmpty className="font-sans text-text-muted">
          {searching ? "Searching…" : "No results found."}
        </CommandEmpty>

        {hits.length > 0 && (
          <>
            <CommandGroup heading="Tickets" className={GROUP_LABEL}>
              {hits.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`ticket-${t.id}`}
                  onSelect={() => go(`/tickets/${t.id}`)}
                >
                  <Ticket size={15} className="text-primary-strong" />
                  <span className="font-mono text-[12.5px] text-text-faint">
                    #{t.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <Badge tone={STATUS_TONE[t.status as TicketStatus] ?? "neutral"}>
                    {STATUS_LABEL[t.status as TicketStatus] ?? t.status}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Go to" className={GROUP_LABEL}>
          {/* The registry filtered by the server — same single owner as the
              sidebar; no page list lives in this file. */}
          {entries.filter(
            (entry) =>
              query.trim() === "" ||
              entry.label.toLowerCase().includes(query.trim().toLowerCase()),
          ).map((entry) => {
            const Icon = NAV_ICONS[entry.icon];
            return (
              <CommandItem
                key={entry.href}
                value={entry.href}
                onSelect={() => go(entry.href)}
              >
                <Icon size={15} />
                {entry.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
