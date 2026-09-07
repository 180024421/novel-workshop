/** 章摘要账本：写后续章时注入近 N 章摘要，降低连贯成本 */

export type ChapterSummary = {
  chapterId: string;
  title: string;
  summary: string;
  words: number;
  updatedAt: string;
};

export type SummariesLedger = {
  items: ChapterSummary[];
  updatedAt: string;
};

export function summarizePrompt(chapterId: string, title: string, body: string): string {
  return `用 100～200 字中文概括本章情节（含关键冲突与章末钩子），不要引号，不要标题。
章：${chapterId} ${title}
正文：
${body.slice(0, 12000)}`;
}

export function parseSummaryText(raw: string): string {
  return (raw || "")
    .replace(/^```[\s\S]*?```/g, "")
    .replace(/^["「]|["」]$/g, "")
    .trim()
    .slice(0, 400);
}

export async function loadSummaries(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<SummariesLedger> {
  if (!window.moshu) return { items: [], updatedAt: "" };
  return window.moshu.readJson<SummariesLedger>(await join(root, "continuity", "summaries.json"), {
    items: [],
    updatedAt: "",
  });
}

export async function saveSummaries(
  root: string,
  join: (...p: string[]) => Promise<string>,
  ledger: SummariesLedger
) {
  if (!window.moshu) return;
  await window.moshu.writeJson(await join(root, "continuity", "summaries.json"), {
    ...ledger,
    updatedAt: new Date().toISOString(),
  });
}

export async function upsertChapterSummary(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  chapterId: string;
  title: string;
  summary: string;
  words: number;
}) {
  const ledger = await loadSummaries(opts.root, opts.join);
  const item: ChapterSummary = {
    chapterId: opts.chapterId,
    title: opts.title,
    summary: opts.summary.trim(),
    words: opts.words,
    updatedAt: new Date().toISOString(),
  };
  const idx = ledger.items.findIndex((x) => x.chapterId === opts.chapterId);
  if (idx >= 0) ledger.items[idx] = item;
  else ledger.items.push(item);
  ledger.items.sort((a, b) => a.chapterId.localeCompare(b.chapterId, "zh"));
  await saveSummaries(opts.root, opts.join, ledger);
  return item;
}

/** 取当前章之前最近 limit 条摘要，按章号升序 */
export function formatRecentSummariesForPrompt(
  ledger: SummariesLedger,
  beforeChapterId: string,
  limit = 5
): string {
  const items = ledger.items
    .filter((x) => x.chapterId.localeCompare(beforeChapterId, "zh") < 0 && x.summary.trim())
    .slice(-Math.max(1, limit));
  if (!items.length) return "";
  return [
    "【近章摘要｜只作连贯参考，禁止复述整段】",
    ...items.map((x) => `- ${x.chapterId} ${x.title}：${x.summary}`),
  ].join("\n");
}
