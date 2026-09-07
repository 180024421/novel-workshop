import MiniSearch from "minisearch";
import type { KbChunk } from "../types";
import type { ProviderConfig } from "./providerPresets";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 80;

export const KB_TAG_OPTIONS = ["节奏", "对白", "战斗", "环境", "感情"] as const;

export function chapterKbSource(chapterId: string): string {
  return `chapter:${chapterId}`;
}

export function chunkText(source: string, text: string, tags: string[] = []): KbChunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: KbChunk[] = [];
  let i = 0;
  let idx = 0;
  while (i < clean.length) {
    const slice = clean.slice(i, i + CHUNK_SIZE);
    chunks.push({
      id: `${source}#${idx}`,
      source,
      text: slice,
      tags,
    });
    idx += 1;
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

export function buildSearch(chunks: KbChunk[]) {
  const ms = new MiniSearch({
    fields: ["text", "source", "tags"],
    storeFields: ["text", "source", "tags"],
    searchOptions: { boost: { text: 2 }, fuzzy: 0.15, prefix: true },
  });
  ms.addAll(
    chunks.map((c) => ({
      id: c.id,
      text: c.text,
      source: c.source,
      tags: c.tags.join(" "),
    }))
  );
  return ms;
}

export type RetrieveChunksOpts = {
  /** 仅检索 source 以此前缀开头的片段（如 `chapter:` 或 `chapter:第3章`） */
  sourcePrefix?: string;
};

export function retrieveChunks(
  chunks: KbChunk[],
  query: string,
  limit = 5,
  preferredTags: string[] = [],
  opts?: RetrieveChunksOpts
): KbChunk[] {
  const prefix = opts?.sourcePrefix?.trim();
  const pool = prefix ? chunks.filter((c) => c.source.startsWith(prefix)) : chunks;
  if (!pool.length || !query.trim()) return [];
  const ms = buildSearch(pool);
  const hits = ms.search(query, { combineWith: "OR" });
  const byId = new Map(pool.map((c) => [c.id, c]));
  const pref = new Set(preferredTags.filter(Boolean));
  const scored = hits
    .map((h) => {
      const c = byId.get(String(h.id));
      if (!c) return null;
      let bonus = 0;
      if (pref.size) {
        for (const t of c.tags || []) {
          if (pref.has(t)) bonus += 8;
        }
      }
      return { c, score: (h.score || 0) + bonus };
    })
    .filter(Boolean) as { c: KbChunk; score: number }[];
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.c);
}

/** 取第一个启用且带 Key 的渠道，供 OpenAI 兼容 `/embeddings` 使用 */
export function pickEmbeddingProvider(
  providers?: ProviderConfig[] | null
): ProviderConfig | null {
  if (!providers?.length) return null;
  return (
    providers.find((p) => p.enabled && Boolean(p.apiKey?.trim()) && Boolean(p.baseUrl?.trim())) ||
    null
  );
}

/** 开关开启且至少有一个可用 provider 时可尝试 embedding；否则回退 MiniSearch */
export function kbEmbeddingApiReady(providers?: ProviderConfig[] | null): boolean {
  return Boolean(pickEmbeddingProvider(providers));
}

/**
 * 将某一章正文切片写入 kb/index.json（替换该章旧切片）。
 * embedding 未就绪时仅写文本切片，检索仍走 MiniSearch。
 */
export async function indexChapterToKb(
  root: string,
  join: (...parts: string[]) => Promise<string>,
  chapterId: string,
  body: string
): Promise<void> {
  if (!window.moshu || !chapterId.trim()) return;
  const source = chapterKbSource(chapterId);
  const path = await join(root, "kb", "index.json");
  const idx = await window.moshu.readJson<{ chunks: KbChunk[] }>(path, { chunks: [] });
  const without = (idx.chunks || []).filter((c) => c.source !== source);
  const tags = ["正文", ...inferKbTags(body)];
  const nextChunks = body.trim()
    ? [...without, ...chunkText(source, body, [...new Set(tags)])]
    : without;
  await window.moshu.writeJson(path, {
    chunks: nextChunks,
    updatedAt: new Date().toISOString(),
  });
}

/** 从细纲文字推断偏好标签 */
export function inferKbTags(text: string): string[] {
  const tags: string[] = [];
  const t = text || "";
  if (/打|战|杀|刀|枪|拳|对决|厮杀/.test(t)) tags.push("战斗");
  if (/说|道|问|答|对白|嘴/.test(t)) tags.push("对白");
  if (/爱|吻|情|心动|暧昧/.test(t)) tags.push("感情");
  if (/雨|风|街|屋|夜|山|城|气味|光/.test(t)) tags.push("环境");
  if (/节奏|钩子|爽|压抑|爆发/.test(t) || tags.length === 0) tags.push("节奏");
  return [...new Set(tags)];
}

export function formatKbForPrompt(chunks: KbChunk[]): string {
  if (!chunks.length) return "";
  return [
    "【参考范文片段｜只学节奏与声口，禁止大段复述原文】",
    ...chunks.map(
      (c, i) =>
        `--- 片段${i + 1}（来源：${c.source}${c.tags?.length ? " · " + c.tags.join("/") : ""}）\n${c.text}`
    ),
  ].join("\n\n");
}
