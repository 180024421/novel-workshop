/**
 * ================================================
 * FLOW: Chapter Catalog Sidebar（章目录侧栏）
 * 纯逻辑层：卷细纲 Markdown 的章行操作 + 角标状态 + 事件化刷新
 * ------------------------------------------------
 * 消费方：ChapterSidebar.tsx（Screen 1/2）、InlineRenameItem.tsx（Screen 3）
 * 设计原则：与 Flow A materialLamps 一致——纯函数先行，磁盘操作只是薄壳，
 *          全部可被 vitest 覆盖（磁盘壳不测，靠 window.moshu 守卫降级）。
 * ================================================
 */
import { isChapterFileForId, syncChapterFileName } from "../../lib/chapterFiles";
import {
  appendChapterListLine,
  emptyVolumeBeatsTemplate,
  splitVolumeChapterBlocks,
  upsertChapterBeats,
  volumeBeatsPath,
} from "../../lib/volumes";
import type { ChapterItemState, ChapterRowView } from "./types";

type JoinFn = (...parts: string[]) => Promise<string>;

export function chapterNum(chapterId: string): number | null {
  const n = String(chapterId).match(/\d+/)?.[0];
  return n == null ? null : Number(n);
}

/* ---------- 纯函数：卷细纲 Markdown 章行操作 ---------- */

const LIST_LINE_RE = /^([-*•]\s*)第\s*(\d+)\s*章(\s+)([\s\S]*)$/;
const HEADING_RE = /^(#{1,4}\s*第\s*)(\d+)(\s*章)(\s*)([^\n]*)$/;

/**
 * 重命名一章：同时改「章节列表」行与分章细纲标题行。
 * 列表行保留 ` —— 章核｜钩子` 尾注，只替换标题段。
 */
export function renameChapterInVolumeMd(
  volumeMd: string,
  chapterId: string,
  newTitle: string
): string {
  const n = chapterNum(chapterId);
  if (n == null) return volumeMd;
  const title = newTitle.trim() || "未命名";
  return volumeMd
    .split("\n")
    .map((line) => {
      const list = line.match(LIST_LINE_RE);
      if (list && Number(list[2]) === n) {
        const rest = list[4];
        const si = rest.search(/\s[—–]{1,2}\s/);
        const suffix = si >= 0 ? rest.slice(si) : "";
        return `${list[1]}第${n}章${list[3]}${title}${suffix}`;
      }
      const head = line.match(HEADING_RE);
      if (head && Number(head[2]) === n) {
        return `${head[1]}${n}${head[3]} ${title}`;
      }
      return line;
    })
    .join("\n");
}

/** 找到目录列表行（含行号），供删除/撤销使用 */
export function findChapterListLine(
  volumeMd: string,
  chapterId: string
): { line: string; index: number } | null {
  const n = chapterNum(chapterId);
  if (n == null) return null;
  const lines = volumeMd.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LIST_LINE_RE);
    if (m && Number(m[2]) === n) return { line: lines[i], index: i };
  }
  return null;
}

/** 精确移除目录列表行（区别于 volumes.removeChapterListLine 的全量正则），返回被删行供撤销 */
export function removeChapterListLineExact(
  volumeMd: string,
  chapterId: string
): { md: string; removedLine: string | null } {
  const found = findChapterListLine(volumeMd, chapterId);
  if (!found) return { md: volumeMd, removedLine: null };
  const lines = volumeMd.split("\n");
  lines.splice(found.index, 1);
  return { md: lines.join("\n"), removedLine: found.line };
}

/** 按章号顺序插入目录行；没有任何目录行时退回 appendChapterListLine */
export function insertChapterLineOrdered(
  volumeMd: string,
  chapterId: string,
  lineText: string
): string {
  const n = chapterNum(chapterId);
  if (n == null) return volumeMd;
  const lines = volumeMd.split("\n");
  let lastListIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LIST_LINE_RE);
    if (!m) continue;
    lastListIdx = i;
    if (Number(m[2]) > n) {
      lines.splice(i, 0, lineText);
      return lines.join("\n");
    }
  }
  if (lastListIdx >= 0) {
    lines.splice(lastListIdx + 1, 0, lineText);
    return lines.join("\n");
  }
  return appendChapterListLine(
    volumeMd,
    chapterId,
    lineText.replace(/^[-*•]\s*第\s*\d+\s*章\s*/, "") || "未命名"
  );
}

/* ---------- 角标状态 ---------- */

/** 队列/生成中的临时态覆盖持久态（override 优先） */
export function chapterBadgeState(
  row: Pick<ChapterRowView, "hasChapter">,
  override?: Extract<ChapterItemState, "generating" | "queued" | "failed">
): ChapterItemState {
  if (override) return override;
  return row.hasChapter ? "done" : "draft";
}

export const CHAPTER_BADGE_META: Record<
  ChapterItemState,
  { label: string; color: string; tip: string }
> = {
  draft: { label: "草稿", color: "rgba(255,255,255,0.35)", tip: "有目录无正文" },
  generating: { label: "生成中", color: "#d4a574", tip: "AI 正在写本章" },
  done: { label: "完成", color: "#7cbc8e", tip: "正文已落盘" },
  queued: { label: "排队", color: "rgba(255,255,255,0.2)", tip: "在续章队列中" },
  failed: { label: "失败", color: "#e07a6a", tip: "队列生成失败，点开介入" },
};

/* ---------- 事件化刷新（修「新章要切卷才出现」） ---------- */

/** 任何改章目录/正文文件的磁盘操作后派发；AppLayout 监听后 ≤1s 重算列表 */
export const CHAPTERS_DIRTY_EVENT = "moshu:chapters-dirty";

export function notifyChaptersDirty(): void {
  window.dispatchEvent(new CustomEvent(CHAPTERS_DIRTY_EVENT));
}

/* ---------- 磁盘操作薄壳（window.moshu 缺失时静默降级为 false） ---------- */

async function readVolumeMd(join: JoinFn, root: string, volumeId: string): Promise<string> {
  const w = window.moshu;
  if (!w) return "";
  return w.readText(await join(root, "beats", volumeBeatsPath(volumeId)));
}

async function writeVolumeMd(
  join: JoinFn,
  root: string,
  volumeId: string,
  md: string
): Promise<void> {
  const w = window.moshu;
  if (!w) return;
  await w.writeText(await join(root, "beats", volumeBeatsPath(volumeId)), md);
}

/** 重命名：卷细纲目录行 + 细纲块标题 + 正文文件名/首行标题 */
export async function applyRenameChapter(opts: {
  root: string;
  join: JoinFn;
  volumeId: string;
  chapterId: string;
  newTitle: string;
}): Promise<boolean> {
  const w = window.moshu;
  if (!w) return false;
  const title = opts.newTitle.trim() || "未命名";

  const md = await readVolumeMd(opts.join, opts.root, opts.volumeId);
  if (md.trim()) {
    await writeVolumeMd(opts.join, opts.root, opts.volumeId, renameChapterInVolumeMd(md, opts.chapterId, title));
  }

  // 正文文件：改首行标题 → syncChapterFileName 收敛为 `第N章_新名.md`
  try {
    const dir = await opts.join(opts.root, "chapters");
    const files = await w.listDir(dir);
    const match = files.find((f) => isChapterFileForId(f.name, opts.chapterId));
    if (match) {
      const body = await w.readText(match.path);
      const n = chapterNum(opts.chapterId);
      const nextBody =
        n != null && body.trim()
          ? body.replace(HEADING_RE, (_all, p1, _p2, p3) => `${p1}${n}${p3} ${title}`)
          : body;
      await syncChapterFileName({
        root: opts.root,
        join: opts.join,
        chapterId: opts.chapterId,
        title,
        body: nextBody,
      });
    }
  } catch {
    /* 正文改名失败不回滚目录——下次进章仍能看到新目录名 */
  }

  notifyChaptersDirty();
  return true;
}

/** 从目录移除（正文文件保留），返回被删行供撤销 */
export async function applyRemoveChapterFromCatalog(opts: {
  root: string;
  join: JoinFn;
  volumeId: string;
  chapterId: string;
}): Promise<{ ok: boolean; removedLine: string | null }> {
  const w = window.moshu;
  if (!w) return { ok: false, removedLine: null };
  const md = await readVolumeMd(opts.join, opts.root, opts.volumeId);
  const { md: next, removedLine } = removeChapterListLineExact(md, opts.chapterId);
  if (!removedLine) return { ok: false, removedLine: null };
  await writeVolumeMd(opts.join, opts.root, opts.volumeId, next);
  notifyChaptersDirty();
  return { ok: true, removedLine };
}

/** 撤销移除：把原行按章号插回 */
export async function applyRestoreChapterToCatalog(opts: {
  root: string;
  join: JoinFn;
  volumeId: string;
  chapterId: string;
  removedLine: string;
}): Promise<boolean> {
  const w = window.moshu;
  if (!w) return false;
  const md = await readVolumeMd(opts.join, opts.root, opts.volumeId);
  if (findChapterListLine(md, opts.chapterId)) return false; // 已在目录，不重复插
  await writeVolumeMd(
    opts.join,
    opts.root,
    opts.volumeId,
    insertChapterLineOrdered(md, opts.chapterId, opts.removedLine)
  );
  notifyChaptersDirty();
  return true;
}

/**
 * 移动到其他卷：源卷删目录行，目标卷按章号插行并带上有界细纲块。
 * 源卷中残留的孤儿细纲块不影响目录解析（parseChapterList 只认列表区），Phase C 可选清理。
 */
export async function applyMoveChapter(opts: {
  root: string;
  join: JoinFn;
  fromVolumeId: string;
  toVolumeId: string;
  chapterId: string;
  title: string;
}): Promise<boolean> {
  const w = window.moshu;
  if (!w || opts.fromVolumeId === opts.toVolumeId) return false;

  const srcMd = await readVolumeMd(opts.join, opts.root, opts.fromVolumeId);
  const block = splitVolumeChapterBlocks(srcMd).blocks.find((b) => b.id === opts.chapterId)?.text;
  await writeVolumeMd(
    opts.join,
    opts.root,
    opts.fromVolumeId,
    removeChapterListLineExact(srcMd, opts.chapterId).md
  );

  let tgtMd = await readVolumeMd(opts.join, opts.root, opts.toVolumeId);
  if (!tgtMd.trim()) {
    tgtMd = emptyVolumeBeatsTemplate(opts.toVolumeId);
  }
  tgtMd = insertChapterLineOrdered(
    tgtMd,
    opts.chapterId,
    `- ${opts.chapterId} ${opts.title.trim() || "未命名"}`
  );
  if (block) tgtMd = upsertChapterBeats(tgtMd, opts.chapterId, block);
  await writeVolumeMd(opts.join, opts.root, opts.toVolumeId, tgtMd);

  notifyChaptersDirty();
  return true;
}
