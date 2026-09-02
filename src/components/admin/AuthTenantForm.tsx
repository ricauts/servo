"use client";

// Company SSO tenant (OIDC) — configurable at runtime, env vars winning.
// Saving a full issuer/clientId/secret switches Servo from the demo
// user-switcher to real sign-in on the next page load.

import { useState } from "react";
import { AlertTriangle, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Badge from "@/components/common/Badge";
import Spinner from "@/components/common/Spinner";

export interface AuthTenantView {
  mode: "oidc" | "demo";
  issuer: string;
  clientId: string;
  providerName: string;
  adminEmails: string;
  allowedDomains: string;
  secretSet: boolean;
  secretSource: "env" | "db" | "none";
}

export default function AuthTenantForm({ initial }: { initial: AuthTenantView }) {
  const router = useRouter();
  const [issuer, setIssuer] = useState(initial.issuer);
  const [clientId, setClientId] = useState(initial.clientId);
  const [secret, setSecret] = useState("");
  const [providerName, setProviderName] = useState(initial.providerName);
  const [adminEmails, setAdminEmails] = useState(initial.adminEmails);
  const [allowedDomains, setAllowedDomains] = useState(initial.allowedDomains);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(extra?: { authClientSecret: string }) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      authIssuer: issuer.trim(),
      authClientId: clientId.trim(),
      authProviderName: providerName.trim(),
      authAdminEmails: adminEmails.trim(),
      authAllowedDomains: allowedDomains.trim(),
    };
    if (extra) body.authClientSecret = extra.authClientSecret;
    else if (secret.trim() !== "") body.authClientSecret = secret.trim();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Save failed (${res.status}).`);
        return;
      }
      setSecret("");
      toast("SSO settings saved");
      router.refresh();
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  const secretDescription =
    initial.secretSource === "env"
      ? "A client secret is set via OIDC_CLIENT_SECRET — it takes precedence over any secret saved here."
      : initial.secretSource === "db"
        ? "A client secret is stored in Settings (never displayed)."
        : "No client secret configured — Servo stays in demo mode (user switcher).";

  return (
    <div className="flex flex-col gap-4 font-sans">
      <div className="flex items-center gap-2">
        <Badge tone={initial.mode === "oidc" ? "good" : "neutral"}>
          {initial.mode === "oidc" ? "SSO active" : "Demo mode"}
        </Badge>
        <p className="text-xs text-muted-foreground">
          Redirect URI for your IdP:{" "}
          <code className="font-mono text-[11px]">
            {"<your-servo-url>"}/api/auth/callback/oidc
          </code>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="sso-issuer" className="font-heading">
            Issuer URL
          </Label>
          <Input
            id="sso-issuer"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
            disabled={busy}
            className="font-mono text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sso-client" className="font-heading">
            Client ID
          </Label>
          <Input
            id="sso-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={busy}
            className="font-mono text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sso-secret" className="font-heading">
            Client secret
          </Label>
          <Input
            id="sso-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={initial.secretSet ? "•••••••• (secret configured)" : "client secret"}
            disabled={busy}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">{secretDescription}</p>
          {initial.secretSource === "db" && (
            <button
              type="button"
              onClick={() => void save({ authClientSecret: "" })}
              disabled={busy}
              className="self-start text-xs font-medium text-primary-strong hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              Disable SSO (clear secret)
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sso-name" className="font-heading">
            Button label
          </Label>
          <Input
            id="sso-name"
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            placeholder="Company SSO"
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="sso-admins" className="font-heading">
            Admin emails
          </Label>
          <Input
            id="sso-admins"
            value={adminEmails}
            onChange={(e) => setAdminEmails(e.target.value)}
            placeholder="you@company.com, cto@company.com"
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated. These accounts get (and keep) the ADMIN role when
            they sign in; everyone else starts as REQUESTER and can be promoted
            from Settings → Team.
          </p>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="sso-domains" className="font-heading">
            Allowed email domains
          </Label>
          <Input
            id="sso-domains"
            value={allowedDomains}
            onChange={(e) => setAllowedDomains(e.target.value)}
            placeholder="company.com, subsidiary.com"
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated. When set, only accounts on these domains (plus the
            admin emails above) can sign in — recommended whenever the IdP
            accepts accounts outside your organization. Empty allows any
            account your IdP authenticates.
          </p>
        </div>
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
        {busy ? <Spinner size={14} className="text-primary-foreground" /> : <KeyRound size={15} />}
        Save SSO settings
      </Button>
    </div>
  );
}
