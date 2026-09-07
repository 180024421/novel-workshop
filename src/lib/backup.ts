export type BackupMeta = {
  id: string;
  chapterId: string;
  fileName: string;
  createdAt: string;
  words: number;
  note: string;
};

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function backupChapter(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  chapterId: string;
  body: string;
  note?: string;
}): Promise<BackupMeta | null> {
  if (!window.moshu || !opts.body.trim()) return null;
  const id = `${opts.chapterId}_${stamp()}`;
  const fileName = `${id}.md`;
  const path = await opts.join(opts.root, "revisions", fileName);
  await window.moshu.writeText(path, opts.body);
  const meta: BackupMeta = {
    id,
    chapterId: opts.chapterId,
    fileName,
    createdAt: new Date().toISOString(),
    words: opts.body.replace(/\s+/g, "").length,
    note: opts.note || "写前自动备份",
  };
  const indexPath = await opts.join(opts.root, "revisions", "index.json");
  const index = await window.moshu.readJson<{ items: BackupMeta[] }>(indexPath, { items: [] });
  const items = [meta, ...(index.items || [])].slice(0, 80);
  await window.moshu.writeJson(indexPath, { items });
  return meta;
}

export async function listBackups(
  root: string,
  join: (...p: string[]) => Promise<string>,
  chapterId?: string
): Promise<BackupMeta[]> {
  if (!window.moshu) return [];
  const index = await window.moshu.readJson<{ items: BackupMeta[] }>(
    await join(root, "revisions", "index.json"),
    { items: [] }
  );
  const items = index.items || [];
  if (!chapterId) return items;
  return items.filter((x) => x.chapterId === chapterId);
}

export async function restoreBackup(
  root: string,
  join: (...p: string[]) => Promise<string>,
  meta: BackupMeta
): Promise<string> {
  if (!window.moshu) return "";
  return window.moshu.readText(await join(root, "revisions", meta.fileName));
}

export type PruneRevisionsOpts = {
  /** 每章最多保留条数（按时间新→旧），默认 8 */
  keepPerChapter?: number;
  /** 索引总条数上限，默认 80 */
  keepTotal?: number;
  /** 早于 N 天的条目优先删（在 keep 规则之外仍可被裁），默认 0=不按天 */
  olderThanDays?: number;
};

export type PruneRevisionsResult = {
  before: number;
  after: number;
  removed: number;
  deletedFiles: number;
};

/**
 * 清理 revisions：按章保留最近 N 条，再压总上限；可选删过旧条目。
 * 同步删磁盘文件与 index.json。
 */
export async function pruneRevisions(
  root: string,
  join: (...p: string[]) => Promise<string>,
  opts: PruneRevisionsOpts = {}
): Promise<PruneRevisionsResult> {
  if (!window.moshu) {
    return { before: 0, after: 0, removed: 0, deletedFiles: 0 };
  }
  const keepPerChapter = Math.max(1, opts.keepPerChapter ?? 8);
  const keepTotal = Math.max(keepPerChapter, opts.keepTotal ?? 80);
  const olderThanDays = Math.max(0, opts.olderThanDays ?? 0);
  const indexPath = await join(root, "revisions", "index.json");
  const index = await window.moshu.readJson<{ items: BackupMeta[] }>(indexPath, { items: [] });
  const items = [...(index.items || [])];
  const before = items.length;
  if (!before) return { before: 0, after: 0, removed: 0, deletedFiles: 0 };

  const sorted = items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const cutoff =
    olderThanDays > 0 ? Date.now() - olderThanDays * 24 * 3600 * 1000 : 0;

  const keep = new Set<string>();
  const perChapter = new Map<string, number>();
  for (const m of sorted) {
    const n = perChapter.get(m.chapterId) || 0;
    const tooOld = cutoff > 0 && new Date(m.createdAt).getTime() < cutoff;
    if (tooOld && n >= 1) continue;
    if (n >= keepPerChapter) continue;
    if (keep.size >= keepTotal) break;
    keep.add(m.id);
    perChapter.set(m.chapterId, n + 1);
  }

  // 若按天删太狠导致为空，至少保最新一条
  if (!keep.size && sorted[0]) keep.add(sorted[0].id);

  const kept = sorted.filter((m) => keep.has(m.id));
  const drop = sorted.filter((m) => !keep.has(m.id));
  let deletedFiles = 0;
  for (const m of drop) {
    try {
      await window.moshu.deletePath(await join(root, "revisions", m.fileName));
      deletedFiles += 1;
    } catch {
      /* ignore missing */
    }
  }
  await window.moshu.writeJson(indexPath, { items: kept });
  return {
    before,
    after: kept.length,
    removed: drop.length,
    deletedFiles,
  };
}
