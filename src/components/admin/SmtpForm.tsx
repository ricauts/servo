"use client";

import { useState } from "react";
import { AlertTriangle, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Spinner from "@/components/common/Spinner";

export interface SmtpSettingsView {
  enabled: boolean;
  from: string;
  urlSet: boolean;
  urlSource: "env" | "db" | "none";
}

export default function SmtpForm({ initial }: { initial: SmtpSettingsView }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [url, setUrl] = useState("");
  const [from, setFrom] = useState(initial.from);
  const [urlSet, setUrlSet] = useState(initial.urlSet);
  const [urlSource, setUrlSource] = useState(initial.urlSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function save(extra?: { smtpUrl: string }) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { smtpEnabled: enabled, smtpFrom: from };
    if (extra) body.smtpUrl = extra.smtpUrl;
    else if (url.trim() !== "") body.smtpUrl = url.trim();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        smtpUrlSet?: boolean;
        smtpUrlSource?: "env" | "db" | "none";
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      if (typeof data.smtpUrlSet === "boolean") setUrlSet(data.smtpUrlSet);
      if (data.smtpUrlSource) setUrlSource(data.smtpUrlSource);
      setUrl("");
      toast("Email settings saved");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(url.trim() !== "" ? { url: url.trim() } : {}),
          ...(from.trim() !== "" ? { from: from.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        to?: string;
        latencyMs?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Test failed (${res.status}).`);
        return;
      }
      setTestResult(`Sent to ${data.to} in ${data.latencyMs} ms.`);
      toast("Test email sent");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  const urlDescription =
    urlSource === "env"
      ? "An SMTP URL is set via the SMTP_URL environment variable — it takes precedence over any URL saved here."
      : urlSource === "db"
        ? "An SMTP URL is stored in Settings (never displayed — it may embed credentials)."
        : "No SMTP URL configured. Notifications stay off until one is set here or via SMTP_URL.";

  return (
    <div className="flex flex-col gap-4 font-sans">
      <div className="flex items-center gap-2">
        <Switch
          id="smtp-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={busy}
        />
        <Label htmlFor="smtp-enabled" className="font-heading">
          Send email notifications
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Ticket received / ticket resolved to the requester; pending approvals
        to every admin. Sending is best-effort — a broken mail setup never
        blocks ticket flows.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="smtp-url" className="font-heading">
            SMTP URL
          </Label>
          <Input
            id="smtp-url"
            type="password"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={urlSet ? "•••••••• (URL configured)" : "smtp://user:pass@host:587"}
            disabled={busy}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{urlDescription}</p>
          {urlSource === "db" && (
            <button
              type="button"
              onClick={() => void save({ smtpUrl: "" })}
              disabled={busy}
              className="self-start text-xs font-medium text-primary-strong hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              Clear stored URL
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="smtp-from" className="font-heading">
            From address
          </Label>
          <Input
            id="smtp-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="Servo <servo@yourcompany.com>"
            disabled={busy}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      {testResult && <p className="text-sm text-primary-strong">{testResult}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="font-heading"
        >
          {busy && <Spinner size={14} className="text-primary-foreground" />}
          Save email settings
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void sendTest()}
          disabled={busy}
          className="font-heading"
        >
          <MailCheck size={15} />
          Send test email
        </Button>
      </div>
    </div>
  );
}
