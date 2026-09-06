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
