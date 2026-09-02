"use client";

import NextLink from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Badge from "@/components/common/Badge";
import { formatDateTime } from "@/components/admin/time";
import { APPROVAL_STATUS_TONE, RISK_LABEL, RISK_TONE } from "@/lib/labels";
import type { ApprovalStatus, RiskLevel } from "@/lib/types";

export type ApprovalHistoryRow = {
  id: string;
  status: ApprovalStatus;
  toolName: string;
  riskLevel: RiskLevel;
  ticketId: string;
  ticketNumber: number;
  ticketTitle: string;
  deciderName: string | null;
  decidedAt: string | null; // ISO date
};

export default function ApprovalHistoryTable({
  rows,
}: {
  rows: ApprovalHistoryRow[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card font-sans">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-heading">Status</TableHead>
            <TableHead className="font-heading">Tool</TableHead>
            <TableHead className="font-heading">Risk</TableHead>
            <TableHead className="font-heading">Ticket</TableHead>
            <TableHead className="font-heading">Decided by</TableHead>
            <TableHead className="font-heading">Decided at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Badge tone={APPROVAL_STATUS_TONE[a.status]}>{a.status}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{a.toolName}</TableCell>
              <TableCell>
                <Badge tone={RISK_TONE[a.riskLevel]}>
                  {RISK_LABEL[a.riskLevel]}
                </Badge>
              </TableCell>
              <TableCell>
                <NextLink
                  href={`/tickets/${a.ticketId}`}
                  title={a.ticketTitle}
                  className="font-mono text-xs text-primary-strong hover:underline"
                >
                  #{a.ticketNumber}
                </NextLink>
              </TableCell>
              <TableCell>{a.deciderName ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {a.decidedAt ? (
                  <time dateTime={a.decidedAt} suppressHydrationWarning>
                    {formatDateTime(a.decidedAt)}
                  </time>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
