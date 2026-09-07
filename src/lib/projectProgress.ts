import {
  buildChapterIndex,
  chapterDirSignature,
} from "./chapterFiles";
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

type ProgressCacheEntry = {
  chapSig: string;
  beatSig: string;
  metaSig: string;
  /** 单章文件签名 id → name:mtime:size */
  fileSigById: Map<string, string>;
  wordById: Map<string, number>;
  progress: ProjectProgress;
};

const progressCache = new Map<string, ProgressCacheEntry>();

export function invalidateProgressCache(root?: string) {
  if (root) progressCache.delete(root);
  else progressCache.clear();
}

function metaSignature(seed: string, bible: string, outline: string): string {
  return `${seed.length}:${bible.length}:${outline.length}:${outline.slice(0, 40)}`;
}

function beatSignature(
  beatFiles: { name: string; mtimeMs?: number; size?: number }[]
): string {
  return beatFiles
    .filter((f) => f.name.endsWith(".md"))
    .map((f) => `${f.name}:${f.mtimeMs ?? 0}:${f.size ?? 0}`)
    .sort()
    .join("|");
}

function fileSig(f: { name: string; mtimeMs?: number; size?: number }): string {
  return `${f.name}:${f.mtimeMs ?? 0}:${f.size ?? 0}`;
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

  const chapSig = chapterDirSignature(chapterFiles);
  const beatSig = beatSignature(beatFiles);
  const metaSig = metaSignature(seed, bible, outline);
  const cached = progressCache.get(root);
  if (
    cached &&
    cached.chapSig === chapSig &&
    cached.beatSig === beatSig &&
    cached.metaSig === metaSig
  ) {
    return cached.progress;
  }

  const volumes = await loadProjectVolumes({ root, join, outline });
  const chapters = volumes.flatMap((v) => v.chapters);
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

  const chapterById = buildChapterIndex(chapterFiles);
  const prevFileSig = cached?.fileSigById || new Map<string, string>();
  const prevWords = cached?.wordById || new Map<string, number>();
  const fileSigById = new Map<string, string>();
  const wordById = new Map<string, number>();

  async function wordsFor(id: string): Promise<number> {
    const chFile = chapterById.get(id);
    if (!chFile) return 0;
    const sig = fileSig(chFile);
    fileSigById.set(id, sig);
    if (prevFileSig.get(id) === sig && prevWords.has(id)) {
      const w = prevWords.get(id) || 0;
      wordById.set(id, w);
      return w;
    }
    const body = await window.moshu!.readText(chFile.path);
    const w = countWords(body);
    wordById.set(id, w);
    return w;
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
    const words = await wordsFor(c.id);
    const hasChapter = words > 0 && chapterById.has(c.id);
    wordsTotal += words;
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
    const words = await wordsFor(id);
    wordsTotal += words;
    const vol = volumes.find((v) => v.chapters.some((x) => x.id === id)) || volumes[0];
    rows.push({
      id,
      title: f.title,
      volumeId: vol?.id || "第1卷",
      hasBeats: chapterHasBeats(id),
      hasChapter: words > 0,
      words,
    });
  }

  rows.sort((a, b) => {
    const na = Number(a.id.match(/\d+/)?.[0] || 0);
    const nb = Number(b.id.match(/\d+/)?.[0] || 0);
    return na - nb;
  });

  const progress: ProjectProgress = {
    hasSeed: seed.trim().length > 0,
    hasBible: bible.trim().length > 0,
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

  progressCache.set(root, {
    chapSig,
    beatSig,
    metaSig,
    fileSigById,
    wordById,
    progress,
  });

  return progress;
}
