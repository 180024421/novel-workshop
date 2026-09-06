import MiniSearch from "minisearch";
import type { KbChunk } from "../types";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 80;

export const KB_TAG_OPTIONS = ["节奏", "对白", "战斗", "环境", "感情"] as const;

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

export function retrieveChunks(
  chunks: KbChunk[],
  query: string,
  limit = 5,
  preferredTags: string[] = []
): KbChunk[] {
  if (!chunks.length || !query.trim()) return [];
  const ms = buildSearch(chunks);
  const hits = ms.search(query, { combineWith: "OR" });
  const byId = new Map(chunks.map((c) => [c.id, c]));
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
