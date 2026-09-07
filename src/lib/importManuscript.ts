export type ManuscriptChapter = {
  id: string;
  title: string;
  body: string;
};

/** 行首章标题：第N章 / Chapter N / # 第N章 / ### 第N章 */
const CHAPTER_HEADER_RE =
  /^(?:#{1,6}\s*)?(?:第\s*(\d+)\s*章|Chapter\s+(\d+))\s*([:：\-—_]?\s*.*)?$/i;

function cleanTitle(raw: string): string {
  let t = String(raw || "")
    .replace(/^[:：\-—_\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  // 去掉残留 markdown 井号
  t = t.replace(/^#+\s*/, "").trim();
  return t || "未命名";
}

function chapterIdFromNum(n: number): string {
  return `第${n}章`;
}

type HeaderHit = { index: number; num: number; title: string; lineLen: number };

function findHeaders(lines: string[]): HeaderHit[] {
  const hits: HeaderHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = line.match(CHAPTER_HEADER_RE);
    if (!m) continue;
    const num = Number(m[1] || m[2]);
    if (!Number.isFinite(num) || num < 1) continue;
    hits.push({
      index: i,
      num,
      title: cleanTitle(m[3] || ""),
      lineLen: lines[i].length,
    });
  }
  return hits;
}

/** 次优先：`---` 分隔且前后有短标题行 */
function splitByHr(text: string): ManuscriptChapter[] | null {
  const chunks = text.split(/\n(?:-{3,}|\*{3,}|_{3,})\s*\n/);
  if (chunks.length < 2) return null;

  const out: ManuscriptChapter[] = [];
  let n = 1;
  for (const chunk of chunks) {
    const body = chunk.trim();
    if (!body) continue;
    const lines = body.split(/\r?\n/);
    const first = (lines[0] || "").trim();
    // 标题行：较短且不像大段正文
    const looksTitle =
      first.length > 0 &&
      first.length <= 40 &&
      !first.includes("。") &&
      lines.length >= 2;
    const title = looksTitle ? cleanTitle(first.replace(/^#+\s*/, "")) : `导入${n}`;
    const rest = looksTitle ? lines.slice(1).join("\n").trim() : body;
    out.push({
      id: chapterIdFromNum(n),
      title,
      body: rest,
    });
    n++;
  }
  return out.length >= 2 ? out : null;
}

/**
 * 将 TXT/MD 书稿按章标题拆分。
 * 无法识别时回退为单章「第1章 / 导入」。
 */
export function splitManuscript(text: string): ManuscriptChapter[] {
  const raw = String(text ?? "").replace(/^\uFEFF/, "");
  if (!raw.trim()) {
    return [{ id: "第1章", title: "导入", body: "" }];
  }

  const lines = raw.split(/\r?\n/);
  const headers = findHeaders(lines);

  if (headers.length > 0) {
    const chapters: ManuscriptChapter[] = [];
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const start = h.index + 1;
      const end = i + 1 < headers.length ? headers[i + 1].index : lines.length;
      const body = lines.slice(start, end).join("\n").trim();
      chapters.push({
        id: chapterIdFromNum(h.num),
        title: h.title,
        body,
      });
    }
    // 若首个标题前有前言，并入第 1 章（或作为独立前导不丢弃：并入首章）
    if (headers[0].index > 0) {
      const preamble = lines.slice(0, headers[0].index).join("\n").trim();
      if (preamble && chapters[0]) {
        chapters[0] = {
          ...chapters[0],
          body: chapters[0].body ? `${preamble}\n\n${chapters[0].body}` : preamble,
        };
      }
    }
    return chapters;
  }

  const byHr = splitByHr(raw);
  if (byHr) return byHr;

  return [{ id: "第1章", title: "导入", body: raw.trim() }];
}

/** 预览表：更新某一章标题/正文 */
export function updateManuscriptChapter(
  chapters: ManuscriptChapter[],
  index: number,
  patch: Partial<Pick<ManuscriptChapter, "title" | "body" | "id">>
): ManuscriptChapter[] {
  return chapters.map((c, i) => (i === index ? { ...c, ...patch } : c));
}

/** 删除预览章；可选重编号 */
export function removeManuscriptChapter(
  chapters: ManuscriptChapter[],
  index: number,
  renumber = true
): ManuscriptChapter[] {
  const next = chapters.filter((_, i) => i !== index);
  if (!renumber) return next;
  return next.map((c, i) => ({ ...c, id: `第${i + 1}章` }));
}

/** 合并到上一章（正文拼接），删除当前行 */
export function mergeManuscriptChapterUp(
  chapters: ManuscriptChapter[],
  index: number
): ManuscriptChapter[] {
  if (index <= 0 || index >= chapters.length) return chapters;
  const prev = chapters[index - 1];
  const cur = chapters[index];
  const mergedBody = [prev.body.trim(), cur.body.trim()].filter(Boolean).join("\n\n");
  const next = chapters.map((c, i) =>
    i === index - 1 ? { ...c, body: mergedBody } : c
  );
  return removeManuscriptChapter(next, index, true);
}

/** 估算是否超过导入体积上限（按 UTF-8 近似字节） */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;

export function estimateTextBytes(text: string): number {
  // TextEncoder 在测试/Node 可用；回退到 length*3
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return text.length * 3;
}
