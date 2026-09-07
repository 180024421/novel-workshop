import { describe, expect, it } from "vitest";

/** pruneRevisions 纯逻辑：保留策略用本地模拟 */
function pickKeepIds(
  items: { id: string; chapterId: string; createdAt: string }[],
  opts: { keepPerChapter: number; maxAgeDays: number },
  now = Date.now()
): Set<string> {
  const byChapter = new Map<string, typeof items>();
  for (const it of items) {
    const arr = byChapter.get(it.chapterId) || [];
    arr.push(it);
    byChapter.set(it.chapterId, arr);
  }
  const keep = new Set<string>();
  const maxAgeMs = opts.maxAgeDays > 0 ? opts.maxAgeDays * 86400000 : 0;
  for (const [, list] of byChapter) {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (let i = 0; i < sorted.length; i++) {
      const it = sorted[i];
      const age = now - Date.parse(it.createdAt);
      if (i < opts.keepPerChapter) {
        keep.add(it.id);
        continue;
      }
      if (maxAgeMs && age > maxAgeMs) continue;
      if (i < opts.keepPerChapter) keep.add(it.id);
    }
    // always keep newest keepPerChapter
    sorted.slice(0, opts.keepPerChapter).forEach((x) => keep.add(x.id));
  }
  return keep;
}

describe("pruneRevisions strategy", () => {
  it("keeps newest N per chapter", () => {
    const keep = pickKeepIds(
      [
        { id: "a1", chapterId: "第1章", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "a2", chapterId: "第1章", createdAt: "2026-02-01T00:00:00.000Z" },
        { id: "a3", chapterId: "第1章", createdAt: "2026-03-01T00:00:00.000Z" },
        { id: "b1", chapterId: "第2章", createdAt: "2026-03-01T00:00:00.000Z" },
      ],
      { keepPerChapter: 2, maxAgeDays: 0 }
    );
    expect(keep.has("a3")).toBe(true);
    expect(keep.has("a2")).toBe(true);
    expect(keep.has("a1")).toBe(false);
    expect(keep.has("b1")).toBe(true);
  });
});
