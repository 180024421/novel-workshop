import { parseChapterList } from "./prompts";
import { extractChapterBeats, loadProjectVolumes } from "./volumes";

export type ProjectProgress = {
  hasSeed: boolean;
  hasBible: boolean;
  hasOutline: boolean;
  chapterTotal: number;
  beatsDone: number;
  chaptersDone: number;
  wordsTotal: number;
  chapterRows: {
    id: string;
    title: string;
    volumeId: string;
    hasBeats: boolean;
    hasChapter: boolean;
    words: number;
  }[];
  volumeRows: {
    id: string;
    title: string;
    chapterCount: number;
    hasContent: boolean;
  }[];
};

function countWords(text: string): number {
  const t = text.replace(/\s+/g, "");
  return t.length;
}

export function countTextWords(text: string): number {
  return countWords(text);
}

export async function loadProjectProgress(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<ProjectProgress> {
  const empty: ProjectProgress = {
    hasSeed: false,
    hasBible: false,
    hasOutline: false,
    chapterTotal: 0,
    beatsDone: 0,
    chaptersDone: 0,
    wordsTotal: 0,
    chapterRows: [],
    volumeRows: [],
  };
  if (!window.moshu) return empty;

  const [seed, bible, outline, beatFiles, chapterFiles] = await Promise.all([
    window.moshu.readText(await join(root, "ideas", "seed.md")),
    window.moshu.readText(await join(root, "bible", "world.md")),
    window.moshu.readText(await join(root, "outlines", "outline.md")),
    window.moshu.listDir(await join(root, "beats")),
    window.moshu.listDir(await join(root, "chapters")),
  ]);

  const volumes = await loadProjectVolumes({ root, join, outline });
  const chapters = volumes.flatMap((v) => v.chapters);
  // 兼容：若细纲还没有章，再看总纲里是否残留旧章目录
  const legacyChapters = chapters.length ? chapters : parseChapterList(outline);

  const beatSet = new Set(
    beatFiles.filter((f) => f.name.endsWith(".md")).map((f) => f.name.replace(/\.md$/, ""))
  );

  const volumeBeatText = new Map<string, string>();
  for (const f of beatFiles) {
    if (!f.name.endsWith(".md")) continue;
    const base = f.name.replace(/\.md$/, "");
    if (/^第\d+卷$/.test(base)) {
      volumeBeatText.set(base, await window.moshu.readText(f.path));
    }
  }

  function chapterHasBeats(chapterId: string): boolean {
    if (beatSet.has(chapterId)) return true;
    const vol = volumes.find((v) => v.chapters.some((c) => c.id === chapterId)) || volumes[0];
    if (!vol) return false;
    const volMd = volumeBeatText.get(vol.id) || "";
    if (!volMd.trim()) return false;
    return extractChapterBeats(volMd, chapterId).trim().length > 0;
  }

  const chapterById = new Map<string, { path: string; name: string }>();
  for (const f of chapterFiles) {
    if (!f.name.endsWith(".md")) continue;
    const m = f.name.match(/^(第\d+章)/);
    if (m) chapterById.set(m[1], f);
  }

  let wordsTotal = 0;
  const rows: ProjectProgress["chapterRows"] = [];
  const legacyChapterBeatIds = [...beatSet].filter((id) => /^第\d+章$/.test(id));
  const ids =
    legacyChapters.length > 0
      ? legacyChapters
      : legacyChapterBeatIds.map((id) => ({ id, title: "未命名", blurb: "" }));

  for (const c of ids) {
    if (rows.some((r) => r.id === c.id)) continue;
    const hasBeats = chapterHasBeats(c.id);
    const chFile = chapterById.get(c.id);
    let words = 0;
    let hasChapter = false;
    if (chFile) {
      const body = await window.moshu.readText(chFile.path);
      words = countWords(body);
      hasChapter = body.trim().length > 0;
      wordsTotal += words;
    }
    const vol = volumes.find((v) => v.chapters.some((x) => x.id === c.id)) || volumes[0];
    rows.push({
      id: c.id,
      title: c.title,
      volumeId: vol?.id || "第1卷",
      hasBeats,
      hasChapter,
      words,
    });
  }

  for (const [id, f] of chapterById) {
    if (rows.some((r) => r.id === id)) continue;
    const body = await window.moshu.readText(f.path);
    const words = countWords(body);
    wordsTotal += words;
    const vol = volumes.find((v) => v.chapters.some((x) => x.id === id)) || volumes[0];
    rows.push({
      id,
      title: f.name.replace(/^第\d+章_/, "").replace(/\.md$/, ""),
      volumeId: vol?.id || "第1卷",
      hasBeats: chapterHasBeats(id),
      hasChapter: body.trim().length > 0,
      words,
    });
  }

  rows.sort((a, b) => {
    const na = Number(a.id.match(/\d+/)?.[0] || 0);
    const nb = Number(b.id.match(/\d+/)?.[0] || 0);
    return na - nb;
  });

  return {
    hasSeed: seed.trim().length > 0,
    hasBible: bible.trim().length > 0,
    // 总纲：有成文即可（不再要求识别出章节）
    hasOutline: outline.trim().length > 80,
    chapterTotal: rows.length || legacyChapters.length,
    beatsDone: rows.filter((r) => r.hasBeats).length,
    chaptersDone: rows.filter((r) => r.hasChapter).length,
    wordsTotal,
    chapterRows: rows,
    volumeRows: volumes.map((v) => ({
      id: v.id,
      title: v.title,
      chapterCount: v.chapters.length,
      hasContent: v.chapters.length > 0 || Boolean(volumeBeatText.get(v.id)?.trim()),
    })),
  };
}
