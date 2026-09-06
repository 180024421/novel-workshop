/** 章节文件名安全片段（去掉路径非法字符） */
export function safeChapterFileTitle(title: string): string {
  const t = String(title || "未命名")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return t || "未命名";
}

function isChapterFileForId(name: string, chapterId: string): boolean {
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
