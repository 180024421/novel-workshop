import { parseChapterList, type ChapterEntry } from "./prompts";

export type VolumeEntry = {
  id: string; // 第1卷
  title: string;
  chapters: ChapterEntry[];
};

/** 从总纲解析卷；若无显式卷标题，则整书视为第1卷 */
export function parseVolumes(outline: string): VolumeEntry[] {
  const chapters = parseChapterList(outline);
  const volRe = /^#{1,3}\s*第\s*(\d+)\s*卷\s*[：:\s]*(.*)$/gm;
  const marks: { index: number; id: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  const text = outline || "";
  while ((m = volRe.exec(text))) {
    marks.push({
      index: m.index,
      id: `第${Number(m[1])}卷`,
      title: (m[2] || "").trim() || `第${Number(m[1])}卷`,
    });
  }

  if (!marks.length) {
    return [
      {
        id: "第1卷",
        title: "第1卷",
        chapters,
      },
    ];
  }

  const volumes: VolumeEntry[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const slice = text.slice(start, end);
    const chs = parseChapterList(slice);
    volumes.push({
      id: marks[i].id,
      title: marks[i].title,
      chapters: chs.length ? chs : [],
    });
  }

  // 卷标题前的章节并入第1卷
  const firstIdx = marks[0].index;
  if (firstIdx > 0) {
    const before = parseChapterList(text.slice(0, firstIdx));
    if (before.length) {
      volumes[0].chapters = [...before, ...volumes[0].chapters];
    }
  }

  // 若某卷没解析出章，用全书章节按序填（兜底）
  if (volumes.every((v) => !v.chapters.length) && chapters.length) {
    volumes[0].chapters = chapters;
  }

  return volumes;
}

export function findVolumeForChapter(
  volumes: VolumeEntry[],
  chapterId: string
): VolumeEntry | null {
  return volumes.find((v) => v.chapters.some((c) => c.id === chapterId)) || volumes[0] || null;
}

export function volumeBeatsPath(volumeId: string) {
  return `${volumeId}.md`;
}

/** 新卷细纲空模板 */
export function emptyVolumeBeatsTemplate(volumeId: string, title = "") {
  const head = title.trim() ? `${volumeId} ${title.trim()}` : volumeId;
  return `# ${head}

## 本卷简介

（本卷目标、主线推进、情绪弧）

## 章节列表

- 第N章 标题 —— 章核｜钩子

## 分章细纲

`;
}

/** 确保卷细纲文件存在；新建时写入空模板 */
export async function ensureVolumeBeatsFile(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  volumeId: string;
  title?: string;
}): Promise<{ path: string; created: boolean; text: string }> {
  if (!window.moshu) {
    return {
      path: "",
      created: false,
      text: emptyVolumeBeatsTemplate(opts.volumeId, opts.title),
    };
  }
  const path = await opts.join(opts.root, "beats", volumeBeatsPath(opts.volumeId));
  const existing = await window.moshu.readText(path);
  if (existing.trim()) {
    return { path, created: false, text: existing };
  }
  const text = emptyVolumeBeatsTemplate(opts.volumeId, opts.title);
  await window.moshu.writeText(path, text);
  return { path, created: true, text };
}

/** 从细纲文件（及兼容旧总纲）汇总卷与章；章节应以细纲为准 */
export async function loadProjectVolumes(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  outline?: string;
}): Promise<VolumeEntry[]> {
  if (!window.moshu) return [{ id: "第1卷", title: "第1卷", chapters: [] }];
  const outline =
    opts.outline ??
    (await window.moshu.readText(await opts.join(opts.root, "outlines", "outline.md")));

  const beatFiles = await window.moshu.listDir(await opts.join(opts.root, "beats"));
  const volFiles = beatFiles
    .filter((f) => /^第\d+卷\.md$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));

  if (volFiles.length) {
    const volumes: VolumeEntry[] = [];
    for (const f of volFiles) {
      const id = f.name.replace(/\.md$/i, "");
      const text = await window.moshu.readText(f.path);
      const titleMatch = text.match(/^#\s*第\s*\d+\s*卷\s*[：:\s]*(.+)$/m);
      const title = (titleMatch?.[1] || "").trim() || id;
      volumes.push({
        id,
        title,
        chapters: parseChapterList(text),
      });
    }
    return volumes;
  }

  // 兼容：旧书把章目录写在总纲里
  return parseVolumes(outline);
}

/** 从一卷细纲中抽出某一章的段落 */
export function extractChapterBeats(volumeMd: string, chapterId: string): string {
  if (!volumeMd.trim()) return "";
  const n = chapterId.match(/\d+/)?.[0];
  if (!n) return volumeMd;
  // 支持 # / ## / ### 第N章
  const re = new RegExp(
    `(^|\\n)(#{1,4}\\s*第\\s*${n}\\s*章[^\\n]*[\\s\\S]*?)(?=\\n#{1,4}\\s*第\\s*\\d+\\s*章|$)`,
    "i"
  );
  const m = volumeMd.match(re);
  if (m) return m[2].trim();

  // 兼容旧：整文件就是单章细纲
  if (new RegExp(`第\\s*${n}\\s*章`).test(volumeMd.slice(0, 80))) return volumeMd.trim();
  return "";
}

/** 把某章细纲写回卷文件（替换或追加） */
export function upsertChapterBeats(
  volumeMd: string,
  chapterId: string,
  chapterBeats: string
): string {
  const n = chapterId.match(/\d+/)?.[0] || "1";
  const block = chapterBeats.trim() || `# 第${n}章细纲\n\n（空）`;
  const re = new RegExp(
    `(^|\\n)(#{1,4}\\s*第\\s*${n}\\s*章[^\\n]*[\\s\\S]*?)(?=\\n#{1,4}\\s*第\\s*\\d+\\s*章|$)`,
    "i"
  );
  if (re.test(volumeMd)) {
    return volumeMd.replace(re, `$1${block}\n\n`).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }
  const base = volumeMd.trim();
  return (base ? base + "\n\n" : "") + block + "\n";
}

/** 读取细纲：优先卷文件，其次旧的按章文件 */
export async function loadChapterBeatsText(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  chapterId: string;
  volumeId?: string;
  outline?: string;
}): Promise<{ text: string; source: "volume" | "chapter" | "empty"; volumeId: string }> {
  if (!window.moshu) return { text: "", source: "empty", volumeId: opts.volumeId || "第1卷" };
    const outline =
    opts.outline ??
    (await window.moshu.readText(await opts.join(opts.root, "outlines", "outline.md")));
  const volumes = await loadProjectVolumes({
    root: opts.root,
    join: opts.join,
    outline,
  });
  const vol =
    (opts.volumeId && volumes.find((v) => v.id === opts.volumeId)) ||
    findVolumeForChapter(volumes, opts.chapterId) ||
    volumes[0];
  const volumeId = vol?.id || "第1卷";

  const volPath = await opts.join(opts.root, "beats", volumeBeatsPath(volumeId));
  try {
    const volMd = await window.moshu.readText(volPath);
    if (volMd.trim()) {
      const extracted = extractChapterBeats(volMd, opts.chapterId);
      if (extracted) return { text: extracted, source: "volume", volumeId };
      // 卷文件存在但没切出该章时，仍返回空，让上层知道用卷存储
      return { text: "", source: "volume", volumeId };
    }
  } catch {
    /* ignore */
  }

  const legacy = await window.moshu.readText(
    await opts.join(opts.root, "beats", `${opts.chapterId}.md`)
  );
  if (legacy.trim()) return { text: legacy, source: "chapter", volumeId };
  return { text: "", source: "empty", volumeId };
}

/** 从卷细纲中切出各章 ##/### 分章细纲块（保持原文） */
export function splitVolumeChapterBlocks(volumeMd: string): {
  preamble: string;
  blocks: { id: string; text: string }[];
} {
  const text = volumeMd || "";
  const re = /(^|\n)(#{1,4}\s*第\s*(\d+)\s*章[^\n]*[\s\S]*?)(?=\n#{1,4}\s*第\s*\d+\s*章|$)/gi;
  const blocks: { id: string; text: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[3]);
    const blockText = m[2].trim();
    blocks.push({ id: `第${n}章`, text: blockText, index: m.index + (m[1] ? m[1].length : 0) });
  }
  if (!blocks.length) {
    return { preamble: text, blocks: [] };
  }
  const firstIdx = blocks[0].index;
  const preamble = text.slice(0, firstIdx).replace(/\s+$/, "");
  return {
    preamble,
    blocks: blocks.map(({ id, text: t }) => ({ id, text: t })),
  };
}

/** 按给定章 id 顺序重排分章细纲块；顺带重排「章节列表」里的条目顺序（若存在） */
export function reorderVolumeChaptersMd(volumeMd: string, orderedIds: string[]): string {
  const { preamble, blocks } = splitVolumeChapterBlocks(volumeMd);
  if (!blocks.length || !orderedIds.length) return volumeMd;

  const byId = new Map(blocks.map((b) => [b.id, b.text]));
  const used = new Set<string>();
  const orderedBlocks: string[] = [];
  for (const id of orderedIds) {
    const t = byId.get(id);
    if (t) {
      orderedBlocks.push(t);
      used.add(id);
    }
  }
  for (const b of blocks) {
    if (!used.has(b.id)) orderedBlocks.push(b.text);
  }

  let head = preamble;
  const listMatch = head.match(
    /(#{1,4}\s*章节列表[^\n]*\n)([\s\S]*?)(?=\n#{1,4}\s+(?!第\s*\d+\s*章)|$)/i
  );
  if (listMatch) {
    const listBody = listMatch[2];
    const lines = listBody.split(/\r?\n/);
    const lineById = new Map<string, string>();
    const otherLines: string[] = [];
    for (const line of lines) {
      const m = line.match(/第\s*(\d+)\s*章/);
      if (m) {
        lineById.set(`第${Number(m[1])}章`, line);
      } else if (line.trim()) {
        otherLines.push(line);
      }
    }
    const reorderedLines: string[] = [];
    const seen = new Set<string>();
    for (const id of orderedIds) {
      const l = lineById.get(id);
      if (l) {
        reorderedLines.push(l);
        seen.add(id);
      }
    }
    for (const [id, l] of lineById) {
      if (!seen.has(id)) reorderedLines.push(l);
    }
    const newList =
      listMatch[1] +
      [...reorderedLines, ...otherLines].join("\n").replace(/\n+$/, "") +
      "\n";
    head = head.replace(listMatch[0], newList);
  }

  const body = orderedBlocks.join("\n\n");
  return ((head ? head + "\n\n" : "") + body).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
