/** OpenAI 兼容 embeddings；失败由调用方回退 MiniSearch */

export type EmbeddingResult = {
  ok: boolean;
  vectors?: number[][];
  message?: string;
};

export async function fetchEmbeddings(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  inputs: string[];
  signal?: AbortSignal;
}): Promise<EmbeddingResult> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const url = `${base}/embeddings`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({ model: opts.model, input: opts.inputs }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, message: `embedding HTTP ${res.status}: ${t.slice(0, 120)}` };
    }
    const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
    const data = (json.data || []).slice().sort((a, b) => a.index - b.index);
    if (!data.length) return { ok: false, message: "embedding 返回空" };
    return { ok: true, vectors: data.map((d) => d.embedding) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
