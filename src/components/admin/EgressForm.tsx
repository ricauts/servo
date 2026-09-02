"use client";

// Outbound web access card: which hosts the agents' web tools and HTTP
// integrations may open. Empty means "any public host" — private, loopback
// and link-local addresses are refused either way, and naming an internal
// host here is the one way to permit it.

import { useState } from "react";
import { AlertTriangle, Globe } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/common/Spinner";

export interface EgressSettingsView {
  allowlist: string[];
}

export default function EgressForm({ initial }: { initial: EgressSettingsView }) {
  const [value, setValue] = useState(initial.allowlist.join("\n"));
  const [saved, setSaved] = useState(initial.allowlist);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ egressAllowlist: value }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        egressAllowlist?: string[];
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      if (data.egressAllowlist) {
        setSaved(data.egressAllowlist);
        setValue(data.egressAllowlist.join("\n"));
      }
      toast("Outbound web access saved");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 font-sans">
      <p className="text-xs text-muted-foreground">
        Tickets arrive by email, so a URL an agent opens may have been chosen by
        whoever wrote in. Servo resolves every host first and refuses private,
        loopback, link-local and cloud-metadata addresses, and re-checks each
        redirect. This list narrows it further: leave it empty to allow any
        public host, or name hosts to allow only those.
      </p>

      <div className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor="egress-allowlist" className="font-heading">
          Allowed hosts
        </Label>
        <Textarea
          id="egress-allowlist"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          rows={6}
          spellCheck={false}
          placeholder={"status.example.com\n*.docs.example.com\nintranet.corp:8080"}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          One per line. <code className="font-mono">*.example.com</code> covers
          the domain and its subdomains; adding{" "}
          <code className="font-mono">:port</code> restricts to that port.
          {saved.length === 0
            ? " Currently empty — any public host may be opened."
            : ` Currently ${saved.length} host ${saved.length === 1 ? "pattern" : "patterns"}; everything else is refused.`}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong className="font-heading font-semibold text-foreground">
          Reaching an internal service on purpose.
        </strong>{" "}
        A host written out exactly (no <code className="font-mono">*</code>) is
        also permitted to resolve to a private address — that is how an
        intranet page or an internal API behind a custom integration stays
        reachable. A wildcard never unlocks the private ranges.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      <Button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="self-start font-heading"
      >
        {busy ? <Spinner size={14} className="text-primary-foreground" /> : <Globe size={15} />}
        Save allowed hosts
      </Button>
    </div>
  );
}
