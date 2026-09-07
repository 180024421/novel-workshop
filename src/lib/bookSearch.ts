/** 书内全文搜索 */

import { parseChapterFileName } from "./chapterFiles";

export type SearchHit = {
  chapterId: string;
  chapterTitle: string;
  line: number;
  text: string;
  snippet: string;
};

export async function searchInBook(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  query: string;
  limit?: number;
}): Promise<SearchHit[]> {
  const q = opts.query.trim();
  if (!q || !window.moshu) return [];
  const files = await window.moshu.listDir(await opts.join(opts.root, "chapters"));
  const md = files
    .filter((f) => f.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const hits: SearchHit[] = [];
  const limit = opts.limit || 80;
  const lower = q.toLowerCase();

  for (const f of md) {
    const body = await window.moshu.readText(f.path);
    if (!body) continue;
    const parsed = parseChapterFileName(f.name);
    const chapterId = parsed?.id || f.name.replace(/\.md$/, "");
    const chapterTitle = parsed?.title || "";
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().includes(lower)) continue;
      const idx = line.toLowerCase().indexOf(lower);
      const start = Math.max(0, idx - 24);
      const end = Math.min(line.length, idx + q.length + 36);
      hits.push({
        chapterId,
        chapterTitle,
        line: i + 1,
        text: line.trim(),
        snippet: (start > 0 ? "…" : "") + line.slice(start, end).trim() + (end < line.length ? "…" : ""),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
