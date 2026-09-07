/** 章节文件名安全片段（去掉路径非法字符） */
export function safeChapterFileTitle(title: string): string {
  const t = String(title || "未命名")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return t || "未命名";
}

/** 解析 `第N章.md` / `第N章_标题.md` */
export function parseChapterFileName(
  name: string
): { id: string; title: string } | null {
  const m = String(name || "").match(/^(第\d+章)(?:_(.+))?\.md$/i);
  if (!m) return null;
  return {
    id: m[1],
    title: (m[2] || "").trim() || "未命名",
  };
}

export type ChapterFileEntry = {
  path: string;
  name: string;
  title: string;
  mtimeMs?: number;
  size?: number;
};

/** 由 listDir 结果建章索引（同 id 后出现的覆盖前一个） */
export function buildChapterIndex(
  files: { name: string; path: string; mtimeMs?: number; size?: number }[]
): Map<string, ChapterFileEntry> {
  const map = new Map<string, ChapterFileEntry>();
  for (const f of files) {
    if (!f.name.endsWith(".md")) continue;
    const parsed = parseChapterFileName(f.name);
    if (!parsed) continue;
    map.set(parsed.id, {
      path: f.path,
      name: f.name,
      title: parsed.title,
      mtimeMs: f.mtimeMs,
      size: f.size,
    });
  }
  return map;
}

/** 章目录签名：用于进度缓存失效判断 */
export function chapterDirSignature(
  files: { name: string; path: string; mtimeMs?: number; size?: number }[]
): string {
  return files
    .filter((f) => f.name.endsWith(".md"))
    .map((f) => `${f.name}:${f.mtimeMs ?? 0}:${f.size ?? 0}`)
    .sort()
    .join("|");
}

export function isChapterFileForId(name: string, chapterId: string): boolean {
  return name === `${chapterId}.md` || name.startsWith(`${chapterId}_`);
}

/**
 * 将 `第N章*.md` 收敛为 `第N章_安全标题.md`：
 * - 多文件时保留内容最长（最丰富）的一份
 * - 其余副本写空（无 delete API 时的折中）
 */
export async function syncChapterFileName(opts: {
  root: string;
  join: (...parts: string[]) => Promise<string>;
  chapterId: string;
  title: string;
  /** 若调用方刚写过正文，可传入作为候选内容（优先） */
  body?: string;
}): Promise<{ name: string; path: string; consolidated: boolean }> {
  const w = window.moshu;
  if (!w) {
    const name = `${opts.chapterId}_${safeChapterFileTitle(opts.title)}.md`;
    return { name, path: name, consolidated: false };
  }

  const dir = await opts.join(opts.root, "chapters");
  const canonical = `${opts.chapterId}_${safeChapterFileTitle(opts.title)}.md`;
  const targetPath = await opts.join(dir, canonical);

  const files = await w.listDir(dir);
  const matches = files.filter((f) => isChapterFileForId(f.name, opts.chapterId));

  let richest = String(opts.body ?? "");
  let richestFrom = "";
  for (const f of matches) {
    try {
      const text = await w.readText(f.path);
      if (text.length > richest.length) {
        richest = text;
        richestFrom = f.name;
      }
    } catch {
      /* ignore */
    }
  }

  await w.writeText(targetPath, richest);

  let consolidated = false;
  for (const f of matches) {
    if (f.name === canonical) continue;
    consolidated = true;
    try {
      // 若内容已并入目标，清空旧名（无删除 API）
      if (f.name === richestFrom || !richest) {
        await w.writeText(f.path, "");
      } else {
        await w.writeText(f.path, "");
      }
    } catch {
      /* ignore */
    }
  }

  return { name: canonical, path: targetPath, consolidated };
}
