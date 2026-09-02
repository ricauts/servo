"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Timer } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Badge from "@/components/common/Badge";
import Spinner from "@/components/common/Spinner";
import { PRIORITY_LABEL, PRIORITY_TONE } from "@/lib/labels";
import type { Priority } from "@/lib/types";

export interface SlaPolicyView {
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
  escalateOnBreach: boolean;
}

/** Minutes as a compact editable string is confusing; show hours where it helps. */
function hint(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 60 === 0 && minutes < 1440) return `${minutes / 60} h`;
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  return `${(minutes / 60).toFixed(1)} h`;
}

export default function SlaPolicyTable({
  initialPolicies,
}: {
  initialPolicies: SlaPolicyView[];
}) {
  const router = useRouter();
  const [policies, setPolicies] = useState(initialPolicies);
  const [savingPriority, setSavingPriority] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);

  function edit(priority: string, patch: Partial<SlaPolicyView>) {
    setPolicies((prev) =>
      prev.map((p) => (p.priority === priority ? { ...p, ...patch } : p)),
    );
  }

  async function save(policy: SlaPolicyView) {
    setSavingPriority(policy.priority);
    setError(null);
    try {
      const res = await fetch("/api/sla", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      toast(`${PRIORITY_LABEL[policy.priority]} SLA saved`);
    } catch {
      setError("Network error — please retry.");
    } finally {
      setSavingPriority(null);
    }
  }

  async function runScan() {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const res = await fetch("/api/sla/scan", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        scanned?: number;
        breached?: number;
        escalated?: { number: number; to: string }[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `Scan failed (${res.status}).`);
        return;
      }
      const escalated = data.escalated ?? [];
      setScanResult(
        `Checked ${data.scanned} open ticket(s): ${data.breached} past target, ${escalated.length} escalated${
          escalated.length > 0
            ? ` (${escalated.map((e) => `#${e.number}→${e.to}`).join(", ")})`
            : ""
        }.`,
      );
      router.refresh();
    } catch {
      setError("Network error — please retry.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 font-sans">
      <p className="text-xs text-muted-foreground">
        Targets run from ticket creation. The response clock stops at the first
        reply, then the resolution clock takes over. Missing a target escalates
        the ticket one tier inside its group (Junior → Mid → Senior) when the
        row below allows it.
      </p>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-heading text-xs text-muted-foreground">
              Priority
            </TableHead>
            <TableHead className="w-[190px] font-heading text-xs text-muted-foreground">
              First response
            </TableHead>
            <TableHead className="w-[190px] font-heading text-xs text-muted-foreground">
              Resolution
            </TableHead>
            <TableHead className="w-[130px] font-heading text-xs text-muted-foreground">
              Auto-escalate
            </TableHead>
            <TableHead className="w-[90px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((policy) => (
            <TableRow key={policy.priority}>
              <TableCell>
                <Badge tone={PRIORITY_TONE[policy.priority]}>
                  {PRIORITY_LABEL[policy.priority]}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={policy.responseMinutes}
                    onChange={(e) =>
                      edit(policy.priority, {
                        responseMinutes: Number(e.target.value),
                      })
                    }
                    className="w-24"
                    aria-label={`${PRIORITY_LABEL[policy.priority]} response minutes`}
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {hint(policy.responseMinutes)}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={policy.resolutionMinutes}
                    onChange={(e) =>
                      edit(policy.priority, {
                        resolutionMinutes: Number(e.target.value),
                      })
                    }
                    className="w-24"
                    aria-label={`${PRIORITY_LABEL[policy.priority]} resolution minutes`}
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {hint(policy.resolutionMinutes)}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <Switch
                  checked={policy.escalateOnBreach}
                  onCheckedChange={(v) =>
                    edit(policy.priority, { escalateOnBreach: v })
                  }
                  aria-label={`Auto-escalate ${PRIORITY_LABEL[policy.priority]}`}
                />
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingPriority !== null}
                  onClick={() => void save(policy)}
                >
                  {savingPriority === policy.priority && <Spinner size={13} />}
                  Save
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {error && <p className="text-[13px] text-critical">{error}</p>}
      {scanResult && <p className="text-[13px] text-primary-strong">{scanResult}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void runScan()}
          disabled={scanning}
          className="font-heading"
        >
          {scanning ? <Spinner size={14} /> : <Timer size={15} />}
          Run SLA scan now
        </Button>
        <p className="text-xs text-muted-foreground">
          Schedule <code className="font-mono">POST /api/sla/scan</code> (cron
          or any scheduler) with the{" "}
          <code className="font-mono">SLA_SCAN_SECRET</code> header to escalate
          breaches automatically.
        </p>
      </div>
    </div>
  );
}
