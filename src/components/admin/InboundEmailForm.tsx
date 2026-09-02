"use client";

import { useState } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Spinner from "@/components/common/Spinner";

export interface InboundSettingsView {
  enabled: boolean;
  secretSet: boolean;
  secretSource: "env" | "db" | "none";
}

export default function InboundEmailForm({
  initial,
}: {
  initial: InboundSettingsView;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [secret, setSecret] = useState("");
  const [secretSet, setSecretSet] = useState(initial.secretSet);
  const [secretSource, setSecretSource] = useState(initial.secretSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(extra?: { inboundSecret: string }) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { inboundEnabled: enabled };
    if (extra) body.inboundSecret = extra.inboundSecret;
    else if (secret.trim() !== "") body.inboundSecret = secret.trim();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        inboundSecretSet?: boolean;
        inboundSecretSource?: "env" | "db" | "none";
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      if (typeof data.inboundSecretSet === "boolean") setSecretSet(data.inboundSecretSet);
      if (data.inboundSecretSource) setSecretSource(data.inboundSecretSource);
      setSecret("");
      toast("Inbound email settings saved");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  const secretDescription =
    secretSource === "env"
      ? "A shared secret is set via INBOUND_EMAIL_SECRET — it takes precedence over any secret saved here."
      : secretSource === "db"
        ? "A shared secret is stored in Settings (never displayed)."
        : "No shared secret configured — the endpoint rejects every delivery until one is set.";

  return (
    <div className="flex flex-col gap-4 font-sans">
      <div className="flex items-center gap-2">
        <Switch
          id="inbound-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={busy}
        />
        <Label htmlFor="inbound-enabled" className="font-heading">
          Accept inbound email
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Point your mail provider&rsquo;s inbound webhook (SendGrid Inbound
        Parse, Mailgun Routes, Postmark, or a small IMAP relay) at{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          POST /api/inbound/email
        </code>
        . Unknown senders become requesters; a subject carrying{" "}
        <code className="font-mono text-[11px]">{/* no-hex-lint:allow — ticket number in copy, not a colour */}#1029</code> is filed as a
        comment on that ticket, anything else opens a new one and goes through
        triage.
      </p>

      <div className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor="inbound-secret" className="font-heading">
          Shared secret
        </Label>
        <Input
          id="inbound-secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={secretSet ? "•••••••• (secret configured)" : "a long random string"}
          disabled={busy}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          {secretDescription} Send it as the{" "}
          <code className="font-mono text-[11px]">x-servo-token</code> header,
          or as <code className="font-mono text-[11px]">?token=</code> when the
          provider cannot set headers.
        </p>
        {secretSource === "db" && (
          <button
            type="button"
            onClick={() => void save({ inboundSecret: "" })}
            disabled={busy}
            className="self-start text-xs font-medium text-primary-strong hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            Clear stored secret
          </button>
        )}
      </div>

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
        {busy ? (
          <Spinner size={14} className="text-primary-foreground" />
        ) : (
          <Inbox size={15} />
        )}
        Save inbound settings
      </Button>
    </div>
  );
}
