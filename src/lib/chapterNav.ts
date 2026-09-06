/** 章号导航与邻章选取（按数值，避免第10章 < 第2章 的字符串坑） */

export function chapterNum(idOrName: string): number {
  const m = idOrName.match(/第\s*(\d+)\s*章/);
  return m ? Number(m[1]) : 0;
}

export function compareChapterNames(a: string, b: string): number {
  const na = chapterNum(a);
  const nb = chapterNum(b);
  if (na !== nb) return na - nb;
  return a.localeCompare(b, "zh");
}

export type ChapterNavItem = { id: string; title: string };

/** 在细纲章表中找相邻章；无表时按章号 ±1 兜底 */
export function neighborChapter(
  list: ChapterNavItem[],
  currentId: string,
  dir: -1 | 1
): ChapterNavItem | null {
  if (list.length) {
    const idx = list.findIndex((c) => c.id === currentId);
    if (idx >= 0) {
      const next = list[idx + dir];
      return next || null;
    }
    const n = chapterNum(currentId);
    if (dir === 1) {
      const after = list.find((c) => chapterNum(c.id) > n);
      return after || null;
    }
    const before = [...list].reverse().find((c) => chapterNum(c.id) < n);
    return before || null;
  }
  const n = chapterNum(currentId);
  if (!n) return null;
  const target = n + dir;
  if (target < 1) return null;
  return { id: `第${target}章`, title: "未命名" };
}

/** 从 chapters 目录文件列表取上一章正文路径（按章号） */
export function pickPrevChapterFile(
  files: { name: string; path: string }[],
  chapterId: string
): { name: string; path: string } | null {
  const cur = chapterNum(chapterId);
  const md = files
    .filter((c) => c.name.endsWith(".md") && chapterNum(c.name) > 0)
    .filter((c) => chapterNum(c.name) < cur)
    .sort((a, b) => compareChapterNames(a.name, b.name));
  return md.length ? md[md.length - 1] : null;
}
