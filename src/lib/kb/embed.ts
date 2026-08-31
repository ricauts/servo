// The embeddings client and configuration (spec kb-09).
//
// Anthropic has no embeddings API — the client therefore rides the
// OpenAI-compatible path ONLY (POST {baseUrl}/embeddings), one dialect
// covering OpenAI, Ollama and vLLM. An Anthropic-only or Z.AI-only install
// simply leaves kb.embed.* empty and loses nothing but re-ranking:
// keyword-only is a first-class mode, not a failure.
//
// Query egress, stated plainly (the Settings UI repeats it beside the field):
// turning embeddings on means the question text — which may carry requester
// PII — is sent to the configured endpoint on every search. Keyword-only is
// the private default; a local Ollama or vLLM baseUrl is the
// private-with-vectors mode.

export const KB_EMBED_SETTING_KEYS = {
  baseUrl: "kb.embed.baseUrl",
  apiKey: "kb.embed.apiKey",
  model: "kb.embed.model",
  dimensions: "kb.embed.dimensions",
} as const;

/** The fixed vector dimension of DocumentChunk.embedding. */
export const EMBEDDING_DIMS = 1536;

export interface EmbedSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 0 = unspecified (use the endpoint's native dimensionality, capped). */
  dimensions: number;
  /** "mock" selects the deterministic embedder; never silent in production. */
  kind: "openai-compatible" | "mock" | "none";
}

/**
 * Resolve the embedding settings env-first, exactly like getAiSettings()
 * (src/lib/ai/settings.ts): KB_EMBED_BASE_URL / KB_EMBED_API_KEY /
 * KB_EMBED_MODEL / KB_EMBED_DIMENSIONS win over stored Setting rows.
 * d > 1536 is REFUSED at configuration time with the fix named.
 */
export async function getEmbedSettings(env: NodeJS.ProcessEnv = process.env): Promise<EmbedSettings> {
  const { db } = await import("@/lib/db");
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(KB_EMBED_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const baseUrl = env.KB_EMBED_BASE_URL || map.get(KB_EMBED_SETTING_KEYS.baseUrl) || "";
  const apiKey = env.KB_EMBED_API_KEY || map.get(KB_EMBED_SETTING_KEYS.apiKey) || "";
  const model = env.KB_EMBED_MODEL || map.get(KB_EMBED_SETTING_KEYS.model) || "";
  const dimsRaw = env.KB_EMBED_DIMENSIONS || map.get(KB_EMBED_SETTING_KEYS.dimensions) || "0";
  let dimensions = Number.parseInt(dimsRaw, 10);
  if (!Number.isFinite(dimensions) || dimensions < 0) dimensions = 0;

  if (dimensions > EMBEDDING_DIMS) {
    throw new Error(
      `kb.embed.dimensions is ${dimensions}, above the fixed ${EMBEDDING_DIMS}-dimension column. ` +
        `Fix: request fewer dimensions (OpenAI's \`dimensions\` parameter) or use a smaller model. ` +
        `d ≤ ${EMBEDDING_DIMS} is zero-padded — cosine is preserved exactly.`,
    );
  }

  let kind: EmbedSettings["kind"] = "none";
  if (baseUrl.toLowerCase() === "mock" || model.toLowerCase() === "mock") {
    kind = "mock"; // selected the way the mock provider is: explicitly.
  } else if (baseUrl) {
    kind = "openai-compatible";
  }
  return { baseUrl, apiKey, model, dimensions, kind };
}

export interface EmbeddingVector {
  vector: number[];
  /** The native dimension BEFORE zero-padding (0 when there is no vector). */
  dims: number;
  model: string;
}

/** Call POST {baseUrl}/embeddings on the OpenAI-compatible dialect. */
export async function embedWithEndpoint(
  settings: EmbedSettings,
  inputs: string[],
): Promise<EmbeddingVector[]> {
  const url = settings.baseUrl.replace(/\/$/, "") + "/embeddings";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      input: inputs,
      ...(settings.dimensions > 0 ? { dimensions: settings.dimensions } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Embeddings endpoint answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  return inputs.map((_, i) => {
    const item = data.data.find((d) => d.index === i) ?? data.data[i];
    const native = item?.embedding ?? [];
    return padVector(native, settings.model);
  });
}

/** Zero-pad to EMBEDDING_DIMS: padding preserves norm and every dot product,
 *  so cosine similarity is preserved EXACTLY — the property kb-09 asserts. */
export function padVector(native: number[], model: string): EmbeddingVector {
  if (native.length > EMBEDDING_DIMS) {
    throw new Error(`Endpoint returned a ${native.length}-dimension vector; the column is fixed at ${EMBEDDING_DIMS}.`);
  }
  return {
    vector: [...native, ...new Array(EMBEDDING_DIMS - native.length).fill(0)],
    dims: native.length,
    model,
  };
}
