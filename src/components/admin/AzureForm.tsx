"use client";

import { useState } from "react";
import { AlertTriangle, Cloud } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Spinner from "@/components/common/Spinner";

export interface AzureSettingsView {
  tenantId: string;
  clientId: string;
  subscriptionId: string;
  secretSet: boolean;
  secretSource: "env" | "db" | "none";
  configured: boolean;
}

export default function AzureForm({ initial }: { initial: AzureSettingsView }) {
  const [tenantId, setTenantId] = useState(initial.tenantId);
  const [clientId, setClientId] = useState(initial.clientId);
  const [subscriptionId, setSubscriptionId] = useState(initial.subscriptionId);
  const [secret, setSecret] = useState("");
  const [secretSet, setSecretSet] = useState(initial.secretSet);
  const [secretSource, setSecretSource] = useState(initial.secretSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function save(extra?: { azureClientSecret: string }) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      azureTenantId: tenantId.trim(),
      azureClientId: clientId.trim(),
      azureSubscriptionId: subscriptionId.trim(),
    };
    if (extra) body.azureClientSecret = extra.azureClientSecret;
    else if (secret.trim() !== "") body.azureClientSecret = secret.trim();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        azureSecretSource?: "env" | "db" | "none";
      };
      if (!res.ok) {
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      if (data.azureSecretSource) {
        setSecretSource(data.azureSecretSource);
        setSecretSet(data.azureSecretSource !== "none");
      }
      setSecret("");
      toast("Azure settings saved");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-azure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantId.trim(),
          clientId: clientId.trim(),
          subscriptionId: subscriptionId.trim(),
          ...(secret.trim() !== "" ? { clientSecret: secret.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        resourceCount?: number;
        latencyMs?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Test failed (${res.status}).`);
        return;
      }
      setTestResult(
        `Authenticated — ${data.resourceCount} resource(s) visible in ${data.latencyMs} ms.`,
      );
      toast("Azure connection OK");
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  const secretDescription =
    secretSource === "env"
      ? "A client secret is set via AZURE_CLIENT_SECRET — it takes precedence over any secret saved here."
      : secretSource === "db"
        ? "A client secret is stored in Settings (never displayed)."
        : "No client secret configured — azure_list_resources runs in simulated mode.";

  return (
    <div className="flex flex-col gap-4 font-sans">
      <p className="text-xs text-muted-foreground">
        A service principal (client-credentials) with <strong>Reader</strong> on
        the subscription is enough:{" "}
        <code className="font-mono">azure_list_resources</code> only performs
        read-only Resource Manager queries. Deployment tools stay simulated
        behind their approval gate.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="az-tenant" className="font-heading">
            Tenant ID
          </Label>
          <Input
            id="az-tenant"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={busy}
            className="font-mono text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="az-client" className="font-heading">
            Client ID
          </Label>
          <Input
            id="az-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={busy}
            className="font-mono text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="az-secret" className="font-heading">
            Client secret
          </Label>
          <Input
            id="az-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={secretSet ? "•••••••• (secret configured)" : "client secret"}
            disabled={busy}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{secretDescription}</p>
          {secretSource === "db" && (
            <button
              type="button"
              onClick={() => void save({ azureClientSecret: "" })}
              disabled={busy}
              className="self-start text-xs font-medium text-primary-strong hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              Clear stored secret
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="az-subscription" className="font-heading">
            Subscription ID
          </Label>
          <Input
            id="az-subscription"
            value={subscriptionId}
            onChange={(e) => setSubscriptionId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={busy}
            className="font-mono text-[13px]"
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
          Save Azure settings
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void testConnection()}
          disabled={busy}
          className="font-heading"
        >
          <Cloud size={15} />
          Test connection
        </Button>
      </div>
    </div>
  );
}
