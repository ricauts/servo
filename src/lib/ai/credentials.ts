// The BYOK credential pool: named keys assignable to specialized agents, and
// per-call usage logging (tokens, latency, which key) — the raw material for
// the throughput panel. The global Settings config stays the default; a
// profile with a credential runs on it instead.

import type { AgentProfile, AiCredential } from "@prisma/client";
import { db } from "@/lib/db";
import { open } from "@/lib/secret-store";
import {
  getAiSettings,
  ZAI_DEFAULT_MODEL,
  type AiProviderKind,
  type AiSettings,
} from "./settings";
import type { ChatProvider } from "./provider";

export interface ResolvedCredential {
  settings: AiSettings;
  /** Pool credential name, "default" (global config), or "mock". */
  credentialName: string;
}

type ProfileWithCredential = AgentProfile & { credential?: AiCredential | null };

/** The AI settings a run should use: the profile's pool credential, or the
 * global default config when none is assigned. */
export async function settingsForProfile(
  profile: ProfileWithCredential | null,
): Promise<ResolvedCredential> {
  const base = await getAiSettings();
  const credential = profile?.credentialId
    ? (profile.credential ??
      (await db.aiCredential.findUnique({ where: { id: profile.credentialId } })))
    : null;
  if (!credential) {
    return {
      settings: base,
      credentialName: base.provider === "mock" ? "mock" : "default",
    };
  }
  const provider = credential.provider as AiProviderKind;
  return {
    settings: {
      ...base,
      provider,
      configuredProvider: provider,
      // Stored encrypted at rest; nested include reads skip the db-layer
      // decryption, so this single consumer opens it.
      apiKey: open(credential.apiKey),
      baseUrl: credential.baseUrl || undefined,
      model:
        credential.model || (provider === "zai" ? ZAI_DEFAULT_MODEL : base.model),
      keySource: "db",
    },
    credentialName: credential.name,
  };
}

export interface UsageMeta {
  kind: "TRIAGE" | "RESOLVE" | "QA" | "DRAFT" | "ENRICH";
  agentName: string;
  credentialName: string;
  provider: string;
  model: string;
}

/** Wrap a provider so every completion lands in AiUsage (best-effort — the
 * log must never break a run). Failures are recorded with ok=false. */
export function withUsage(inner: ChatProvider, meta: UsageMeta): ChatProvider {
  return {
    async complete(p) {
      const started = Date.now();
      try {
        const turn = await inner.complete(p);
        void db.aiUsage
          .create({
            data: {
              ...meta,
              inputTokens: turn.usage?.inputTokens ?? 0,
              outputTokens: turn.usage?.outputTokens ?? 0,
              latencyMs: Date.now() - started,
            },
          })
          .catch(() => {});
        return turn;
      } catch (err) {
        void db.aiUsage
          .create({
            data: {
              ...meta,
              latencyMs: Date.now() - started,
              ok: false,
              error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
            },
          })
          .catch(() => {});
        throw err;
      }
    },
  };
}
