/** 段落级文本 Diff（改稿对比） */

export type DiffChunk = {
  type: "equal" | "add" | "del" | "replace";
  left?: string;
  right?: string;
};

/** 超过此字符数时降级为整章 replace */
export const DIFF_CHAR_SOFT_LIMIT = 80_000;

export function splitParagraphs(text: string): string[] {
  const normalized = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.trim()) return [];
  return normalized.split(/\n\s*\n/).map((p) => p.replace(/^\n+|\n+$/g, "")).filter((p) => p.length > 0);
}

function joinParagraphs(parts: string[]): string {
  return parts.join("\n\n");
}

/** LCS 长度表 */
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/**
 * 按段落 diff。超长文本返回单块 replace。
 */
export function diffParagraphs(left: string, right: string): DiffChunk[] {
  const total = (left?.length || 0) + (right?.length || 0);
  if (total > DIFF_CHAR_SOFT_LIMIT) {
    if (left === right) return [{ type: "equal", left, right }];
    return [{ type: "replace", left, right }];
  }

  const a = splitParagraphs(left);
  const b = splitParagraphs(right);
  if (!a.length && !b.length) return [];
  if (!a.length) return b.map((p) => ({ type: "add" as const, right: p }));
  if (!b.length) return a.map((p) => ({ type: "del" as const, left: p }));

  const dp = lcsTable(a, b);
  const raw: DiffChunk[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      raw.push({ type: "equal", left: a[i - 1], right: b[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: "add", right: b[j - 1] });
      j--;
    } else {
      raw.push({ type: "del", left: a[i - 1] });
      i--;
    }
  }
  raw.reverse();

  // 合并相邻 del+add → replace
  const out: DiffChunk[] = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    const next = raw[k + 1];
    if (cur.type === "del" && next?.type === "add") {
      out.push({ type: "replace", left: cur.left, right: next.right });
      k++;
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * 按块索引采纳右侧变更，生成新正文。
 * acceptRightIndexes：要对齐 diff 结果中非 equal 块的下标集合。
 * 对 equal 块始终保留；对选中的 add/replace 用 right；未选中的 del/replace 保留 left；未选中的 add 丢弃。
 */
export function applyChunks(
  _left: string,
  _right: string,
  chunks: DiffChunk[],
  acceptRightIndexes: number[]
): string {
  const accept = new Set(acceptRightIndexes);
  const parts: string[] = [];
  chunks.forEach((c, idx) => {
    if (c.type === "equal") {
      if (c.left) parts.push(c.left);
      return;
    }
    if (accept.has(idx)) {
      if (c.type === "del") return;
      if (c.right) parts.push(c.right);
      return;
    }
    // 不采纳右侧：保留左侧（del/replace），忽略 add
    if (c.type === "add") return;
    if (c.left) parts.push(c.left);
  });
  return joinParagraphs(parts);
}

/** 全部采纳右侧（即 right 全文按段落重建，等价于用 right） */
export function acceptAllRight(right: string): string {
  return right;
}
