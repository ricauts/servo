"use client";

// Ticket queue rendered with the shadcn Table. Rows navigate to the detail
// page: the title cell carries a real <Link> (accessible, cmd-clickable) and
// a row-level click handler widens the hit area for mouse users.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Avatar from "@/components/common/Avatar";
import Badge from "@/components/common/Badge";
import RelativeTime from "@/components/tickets/RelativeTime";
import SlaBadge from "@/components/tickets/SlaBadge";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/lib/labels";
import type { Category, Priority, TicketStatus } from "@/lib/types";
import { UNASSIGNED_COLOR } from "@/lib/avatar";

export type TicketRow = {
  id: string;
  number: number;
  title: string;
  requesterName: string;
  status: string;
  /** Entry channel (ux-03); absent renders no badge, like WEB. */
  channel?: string;
  priority: string;
  category: string;
  assigneeName: string | null;
  assigneeColor: string | null;
  assigneeIsAi: boolean;
  /** ISO timestamp */
  updatedAt: string;
  /** ISO timestamps feeding the SLA badge. */
  createdAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
};

export default function TicketsTable({ rows }: { rows: TicketRow[] }) {
  const router = useRouter();

  // Whole-row navigation; anchors/buttons inside cells keep native behavior.
  function onRowClick(e: React.MouseEvent<HTMLTableRowElement>, id: string) {
    if ((e.target as HTMLElement).closest("a, button")) return;
    router.push(`/tickets/${id}`);
  }

  return (
    <Table className="font-sans">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[72px] pl-4 font-heading text-xs text-muted-foreground">
            #
          </TableHead>
          <TableHead className="min-w-[220px] font-heading text-xs text-muted-foreground">
            Title
          </TableHead>
          <TableHead className="w-[150px] font-heading text-xs text-muted-foreground">
            Status
          </TableHead>
          <TableHead className="w-[104px] font-heading text-xs text-muted-foreground">
            Priority
          </TableHead>
          <TableHead className="w-[130px] font-heading text-xs text-muted-foreground">
            SLA
          </TableHead>
          <TableHead className="w-[140px] font-heading text-xs text-muted-foreground">
            Category
          </TableHead>
          <TableHead className="w-[170px] font-heading text-xs text-muted-foreground">
            Assignee
          </TableHead>
          <TableHead className="w-[110px] pr-4 text-right font-heading text-xs text-muted-foreground">
            Updated
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((t) => (
          <TableRow
            key={t.id}
            className="cursor-pointer"
            onClick={(e) => onRowClick(e, t.id)}
          >
            <TableCell className="pl-4 font-mono text-sm font-semibold text-muted-foreground">
              #{t.number}
              {t.channel && t.channel !== "WEB" && (
                <Badge tone="neutral" className="ml-1.5 font-mono text-[10px] uppercase tracking-wide">
                  {t.channel}
                </Badge>
              )}
            </TableCell>
            <TableCell className="max-w-0 py-2.5">
              <Link
                href={`/tickets/${t.id}`}
                className="block truncate text-[13.5px] font-medium text-foreground hover:text-primary-strong"
              >
                {t.title}
              </Link>
              <span className="block truncate text-xs text-muted-foreground">
                {t.requesterName}
              </span>
            </TableCell>
            <TableCell>
              <Badge tone={STATUS_TONE[t.status as TicketStatus] ?? "neutral"}>
                {STATUS_LABEL[t.status as TicketStatus] ?? t.status}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge tone={PRIORITY_TONE[t.priority as Priority] ?? "neutral"}>
                {PRIORITY_LABEL[t.priority as Priority] ?? t.priority}
              </Badge>
            </TableCell>
            <TableCell>
              <SlaBadge ticket={t} />
            </TableCell>
            <TableCell className="truncate text-sm text-muted-foreground">
              {CATEGORY_LABEL[t.category as Category] ?? t.category}
            </TableCell>
            <TableCell>
              {t.assigneeName ? (
                <span className="flex items-center gap-2">
                  <Avatar
                    name={t.assigneeName}
                    color={t.assigneeColor ?? UNASSIGNED_COLOR}
                    size={20}
                    isAi={t.assigneeIsAi}
                  />
                  <span className="truncate text-sm text-muted-foreground">
                    {t.assigneeName}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground/60">—</span>
              )}
            </TableCell>
            <TableCell className="pr-4 text-right text-sm text-muted-foreground">
              <RelativeTime value={t.updatedAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
