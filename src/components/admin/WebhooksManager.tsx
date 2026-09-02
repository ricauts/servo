"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Plus, Radio, Trash2, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Badge from "@/components/common/Badge";
import Spinner from "@/components/common/Spinner";
import { cn } from "@/lib/utils";

export interface WebhookDeliveryView {
  id: string;
  event: string;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}

export interface WebhookView {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  deliveries: WebhookDeliveryView[];
}

const EVENT_OPTIONS = [
  "*",
  "ticket.created",
  "ticket.resolved",
  "ticket.escalated",
  "approval.pending",
  "approval.decided",
];

async function api(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data };
    return {
      ok: false,
      error: (data.error as string) ?? `Request failed (${res.status}).`,
    };
  } catch {
    return { ok: false, error: "Network error — nothing was changed." };
  }
}

/** Traffic-light dot for the most recent delivery. */
function DeliveryDot({ delivery }: { delivery: WebhookDeliveryView | undefined }) {
  const color =
    delivery === undefined
      ? "bg-muted-foreground/30"
      : delivery.ok
        ? "bg-good"
        : "bg-critical";
  const title =
    delivery === undefined
      ? "No deliveries yet"
      : `${delivery.event} — ${delivery.ok ? "delivered" : (delivery.error ?? "failed")} (${delivery.durationMs} ms)`;
  return <span title={title} className={cn("inline-block h-2.5 w-2.5 rounded-full", color)} />;
}

export default function WebhooksManager({ webhooks }: { webhooks: WebhookView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["*"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function toggleEvent(event: string) {
    setEvents((prev) => {
      if (event === "*") return ["*"];
      const withoutStar = prev.filter((e) => e !== "*" && e !== event);
      const had = prev.includes(event);
      const next = had ? withoutStar : [...withoutStar, event];
      return next.length === 0 ? ["*"] : next;
    });
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await api("/api/webhooks", "POST", { url: url.trim(), events });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    setNewSecret((res.data?.secret as string) ?? null);
    setUrl("");
    setEvents(["*"]);
    router.refresh();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    const res = await api(`/api/webhooks/${id}`, "PATCH", body);
    setBusy(false);
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await api(`/api/webhooks/${id}`, "DELETE");
    setBusy(false);
    setConfirmDelete(null);
    if (!res.ok) setError(res.error ?? null);
    else router.refresh();
  }

  async function test(id: string) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/webhooks/${id}?action=test`, "POST");
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    const delivery = res.data?.delivery as WebhookDeliveryView | null;
    if (delivery?.ok) toast(`Ping delivered in ${delivery.durationMs} ms`);
    else toast(`Ping failed: ${delivery?.error ?? "no response"}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 font-sans">
      <p className="text-xs text-muted-foreground">
        Servo POSTs a JSON payload on ticket and approval events, signed with{" "}
        <code className="font-mono text-[11px]">
          x-servo-signature: sha256=HMAC(secret, body)
        </code>{" "}
        so the receiver can verify authenticity. The secret is shown once at
        creation.
      </p>

      {webhooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No webhooks yet — add one to stream Servo events into Slack bridges,
          SIEMs, or your own automations.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {webhooks.map((hook) => (
            <li key={hook.id} className="flex items-center gap-3 py-2.5">
              <DeliveryDot delivery={hook.deliveries[0]} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{hook.url}</span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {hook.events.map((event) => (
                    <Badge key={event} tone={event === "*" ? "brand" : "neutral"}>
                      {event === "*" ? "all events" : event}
                    </Badge>
                  ))}
                </span>
              </span>
              <Switch
                checked={hook.enabled}
                disabled={busy}
                onCheckedChange={(v) => void patch(hook.id, { enabled: v })}
                aria-label="Webhook enabled"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void test(hook.id)}
              >
                <Zap size={13} />
                Test
              </Button>
              {confirmDelete === hook.id ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove(hook.id)}
                >
                  Confirm
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete webhook"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(hook.id)}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-[13px] text-critical">{error}</p>}

      <Button type="button" className="self-start" onClick={() => setCreating(true)}>
        <Plus size={15} />
        New webhook
      </Button>

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) setNewSecret(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New webhook</DialogTitle>
            <DialogDescription>
              Pick the events to stream and where to POST them.
            </DialogDescription>
          </DialogHeader>

          {newSecret ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                Webhook created. Store this signing secret now —{" "}
                <strong>it will not be shown again</strong>:
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-[12px]">
                  {newSecret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Copy secret"
                  onClick={() => {
                    void navigator.clipboard.writeText(newSecret);
                    toast("Secret copied");
                  }}
                >
                  <Copy size={14} />
                </Button>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => setCreating(false)}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wh-url">Endpoint URL</Label>
                <Input
                  id="wh-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/servo-events"
                  disabled={busy}
                  className="font-mono text-[13px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Events</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EVENT_OPTIONS.map((event) => {
                    const active = events.includes(event);
                    return (
                      <button
                        key={event}
                        type="button"
                        disabled={busy}
                        onClick={() => toggleEvent(event)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] tracking-wide transition-colors",
                          active
                            ? "border-transparent bg-primary/15 text-primary-strong"
                            : "border-border text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        {event === "*" ? "all events" : event}
                      </button>
                    );
                  })}
                </div>
              </div>
              {error && <p className="text-[13px] text-critical">{error}</p>}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCreating(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void create()}
                  disabled={busy || !url.trim()}
                >
                  {busy ? <Spinner size={14} className="text-primary-foreground" /> : <Radio size={15} />}
                  Create webhook
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
