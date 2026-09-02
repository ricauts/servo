"use client";

// First-run wizard for self-hosted installs: create the bootstrap admin and
// (optionally) connect the company's OIDC tenant. Everything here can also be
// changed later from Integrations.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Rocket } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Spinner from "@/components/common/Spinner";

export default function SetupWizard() {
  const router = useRouter();
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [useSso, setUseSso] = useState(false);
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [providerName, setProviderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminName,
          adminEmail,
          ...(useSso
            ? {
                oidcIssuer: issuer,
                oidcClientId: clientId,
                oidcClientSecret: clientSecret,
                oidcProviderName: providerName,
              }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Setup failed (${res.status}).`);
        return;
      }
      router.push(useSso ? "/login" : "/dashboard");
      router.refresh();
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your environment</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4 font-sans">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="su-name">Your name</Label>
              <Input
                id="su-name"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Ada Lovelace"
                disabled={busy}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="su-email">Admin email</Label>
              <Input
                id="su-email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="you@company.com"
                disabled={busy}
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Creates the first administrator and Servo&rsquo;s system AI agents
            (triage, resolver, QA) with default tool and SLA policies.
          </p>

          <div className="flex items-center gap-2 border-t border-border pt-4">
            <Switch id="su-sso" checked={useSso} onCheckedChange={setUseSso} disabled={busy} />
            <Label htmlFor="su-sso" className="font-heading">
              Connect your company&rsquo;s SSO tenant now (OIDC)
            </Label>
          </div>

          {useSso && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="su-issuer">Issuer URL</Label>
                <Input
                  id="su-issuer"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
                  disabled={busy}
                  className="font-mono text-[13px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="su-client">Client ID</Label>
                <Input
                  id="su-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  disabled={busy}
                  className="font-mono text-[13px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="su-secret">Client secret</Label>
                <Input
                  id="su-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="su-provider">Button label</Label>
                <Input
                  id="su-provider"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  placeholder="Company SSO"
                  disabled={busy}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Redirect URI for your IdP:{" "}
                <code className="font-mono text-[11px]">
                  {"<your-servo-url>"}/api/auth/callback/oidc
                </code>
                . Your admin email keeps the ADMIN role when signing in through
                SSO. Skip this and Servo runs in demo mode until you connect a
                tenant from Integrations.
              </p>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}

          <Button type="submit" disabled={busy} className="self-start font-heading">
            {busy ? <Spinner size={14} className="text-primary-foreground" /> : <Rocket size={15} />}
            Finish setup
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
