import type { AppSettings, KbChunk } from "../types";
import { cosineSim, fetchEmbeddings } from "./embedding";
import {
  kbEmbeddingApiReady,
  pickEmbeddingProvider,
  retrieveChunks,
  type RetrieveChunksOpts,
} from "./kb";
import type { ProviderConfig } from "./providerPresets";

/** MiniSearch 先取候选再向量重排的池大小 */
export const HYBRID_CANDIDATE_LIMIT = 20;

export type ScoredChunk = { chunk: KbChunk; score: number };

/**
 * 按余弦相似度对候选切片重排（纯函数，便于单测）。
 */
export function rerankChunksByCosine(
  queryVec: number[],
  items: { chunk: KbChunk; vector: number[] }[],
  limit: number
): KbChunk[] {
  const scored: ScoredChunk[] = items.map((it) => ({
    chunk: it.chunk,
    score: cosineSim(queryVec, it.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, limit)).map((x) => x.chunk);
}

type VectorStore = Record<string, number[]>;

async function loadVectorStore(
  root: string | undefined,
  join: ((...p: string[]) => Promise<string>) | undefined
): Promise<VectorStore> {
  if (!root || !join || !window.moshu?.readJson) return {};
  try {
    const path = await join(root, "kb", "vectors.json");
    const raw = await window.moshu.readJson<VectorStore>(path, {});
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function saveVectorStore(
  root: string | undefined,
  join: ((...p: string[]) => Promise<string>) | undefined,
  store: VectorStore
): Promise<void> {
  if (!root || !join || !window.moshu?.writeJson) return;
  try {
    const path = await join(root, "kb", "vectors.json");
    await window.moshu.writeJson(path, store);
  } catch {
    /* best-effort */
  }
}

/**
 * MiniSearch 取候选后可选 embedding 重排；失败回退词法结果。
 */
export async function retrieveChunksHybrid(opts: {
  chunks: KbChunk[];
  query: string;
  limit?: number;
  tags?: string[];
  retrieveOpts?: RetrieveChunksOpts;
  settings: AppSettings;
  providers: ProviderConfig[];
  root?: string;
  join?: (...p: string[]) => Promise<string>;
  signal?: AbortSignal;
  candidateLimit?: number;
}): Promise<KbChunk[]> {
  const limit = opts.limit ?? 5;
  const tags = opts.tags || [];
  const pool = opts.candidateLimit ?? HYBRID_CANDIDATE_LIMIT;
  const lexical = retrieveChunks(opts.chunks, opts.query, pool, tags, opts.retrieveOpts);
  if (!lexical.length) return [];

  const wantHybrid =
    opts.settings.kbEmbeddingEnabled === true && kbEmbeddingApiReady(opts.providers);
  if (!wantHybrid) return lexical.slice(0, limit);

  const provider = pickEmbeddingProvider(opts.providers);
  if (!provider) return lexical.slice(0, limit);

  try {
    const model =
      (opts.settings.kbEmbeddingModel || "").trim() || "text-embedding-3-small";
    const cache = await loadVectorStore(opts.root, opts.join);
    const missing = lexical.filter((c) => !cache[c.id]?.length);
    const inputs = [opts.query, ...missing.map((c) => c.text)];
    const emb = await fetchEmbeddings({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model,
      inputs,
      signal: opts.signal,
    });
    if (!emb.ok || !emb.vectors || emb.vectors.length !== inputs.length) {
      return lexical.slice(0, limit);
    }

    const queryVec = emb.vectors[0];
    let vi = 1;
    const nextCache = { ...cache };
    for (const c of missing) {
      nextCache[c.id] = emb.vectors[vi++];
    }
    if (missing.length) {
      await saveVectorStore(opts.root, opts.join, nextCache);
    }

    const items = lexical
      .map((chunk) => {
        const vector = nextCache[chunk.id];
        return vector?.length ? { chunk, vector } : null;
      })
      .filter(Boolean) as { chunk: KbChunk; vector: number[] }[];

    if (items.length < lexical.length) {
      // 部分缺向量时仍用已有向量重排，不足则用词法补齐
      const ranked = rerankChunksByCosine(queryVec, items, limit);
      if (ranked.length >= limit) return ranked;
      const seen = new Set(ranked.map((c) => c.id));
      for (const c of lexical) {
        if (ranked.length >= limit) break;
        if (!seen.has(c.id)) ranked.push(c);
      }
      return ranked;
    }

    return rerankChunksByCosine(queryVec, items, limit);
  } catch {
    return lexical.slice(0, limit);
  }
}

export type RetrieveForWritingOpts = {
  chunks: KbChunk[];
  query: string;
  tags?: string[];
  settings: AppSettings;
  providers: ProviderConfig[];
  /** 最终注入条数，默认 6 */
  limit?: number;
  chapterLimit?: number;
  generalLimit?: number;
  root?: string;
  join?: (...p: string[]) => Promise<string>;
  signal?: AbortSignal;
};

/**
 * 写章用检索：优先 `chapter:` 源，再合并通用源；可选 embedding 重排。
 */
export async function retrieveForWriting(opts: RetrieveForWritingOpts): Promise<KbChunk[]> {
  const tags = opts.tags || [];
  const chapterLimit = opts.chapterLimit ?? 3;
  const generalLimit = opts.generalLimit ?? 3;
  const finalLimit = opts.limit ?? 6;
  const shared = {
    chunks: opts.chunks,
    query: opts.query,
    tags,
    settings: opts.settings,
    providers: opts.providers,
    root: opts.root,
    join: opts.join,
    signal: opts.signal,
  };

  const chapterHits = await retrieveChunksHybrid({
    ...shared,
    limit: chapterLimit,
    retrieveOpts: { sourcePrefix: "chapter:" },
  });
  const generalHits = await retrieveChunksHybrid({
    ...shared,
    limit: generalLimit,
  });

  const merged: KbChunk[] = [...chapterHits];
  for (const h of generalHits) {
    if (!merged.some((x) => x.id === h.id)) merged.push(h);
  }
  return merged.slice(0, finalLimit);
}
