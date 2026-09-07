/** 过审 / 平台敏感表达本地扫描（不耗 token） */

export type ComplianceLevel = "高危" | "中" | "建议";

export type ComplianceRule = {
  word: string;
  level: ComplianceLevel;
  suggestion?: string;
};

export type ComplianceHit = {
  level: ComplianceLevel;
  word: string;
  context: string;
  suggestion?: string;
  chapterId?: string;
  chapterTitle?: string;
};

const DEFAULT_RULES: ComplianceRule[] = [
  { word: "自杀教程", level: "高危", suggestion: "删改具体方法描写" },
  { word: "详细解剖", level: "中", suggestion: "改为侧面暗示" },
  { word: "血腥淋漓", level: "建议", suggestion: "收敛感官描写" },
  { word: "未成年怀孕", level: "高危", suggestion: "回避或改成年角色" },
  { word: "人肉搜索", level: "中", suggestion: "改为调查/打听" },
  { word: "真人色情", level: "高危", suggestion: "删除相关段落" },
  { word: "赌博教程", level: "中", suggestion: "淡化操作细节" },
  { word: "毒品制作", level: "高危", suggestion: "删除制作流程" },
  { word: "暴恐袭击", level: "高危", suggestion: "弱化具体手法" },
  { word: "仇恨言论", level: "中", suggestion: "改为人物偏见，勿宣扬" },
];

/** 解析 `- 词 | 级别 | 替换建议` 或 `- 词` */
export function parseComplianceRules(md: string): ComplianceRule[] {
  const out: ComplianceRule[] = [];
  for (const line of (md || "").split(/\r?\n/)) {
    const t = line.replace(/^[-*•]\s*/, "").trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/\s*\|\s*/).map((x) => x.trim());
    const word = parts[0];
    if (!word || word.length < 2) continue;
    let level: ComplianceLevel = "建议";
    if (parts[1] === "高危" || parts[1] === "中" || parts[1] === "建议") {
      level = parts[1];
    } else if (/高危|严重/.test(parts[1] || "")) level = "高危";
    else if (/中|警告/.test(parts[1] || "")) level = "中";
    out.push({ word, level, suggestion: parts[2] || undefined });
  }
  return out;
}

export async function loadComplianceRules(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<ComplianceRule[]> {
  if (!window.moshu) return DEFAULT_RULES;
  try {
    const raw = await window.moshu.readText(await join(root, "prompts", "compliance.md"));
    const parsed = parseComplianceRules(raw);
    if (parsed.length) return parsed;
  } catch {
    /* fallback */
  }
  return DEFAULT_RULES;
}

function contextAround(body: string, idx: number, wordLen: number): string {
  const start = Math.max(0, idx - 16);
  const end = Math.min(body.length, idx + wordLen + 24);
  return (
    (start > 0 ? "…" : "") +
    body.slice(start, end).replace(/\s+/g, " ") +
    (end < body.length ? "…" : "")
  );
}

export function scanCompliance(body: string, rules: ComplianceRule[]): ComplianceHit[] {
  const hits: ComplianceHit[] = [];
  const text = body || "";
  if (!text.trim()) return hits;
  for (const r of rules) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(r.word, from);
      if (idx < 0) break;
      hits.push({
        level: r.level,
        word: r.word,
        context: contextAround(text, idx, r.word.length),
        suggestion: r.suggestion,
      });
      from = idx + r.word.length;
      if (hits.length >= 200) return hits;
    }
  }
  return hits;
}

export function applyComplianceSuggestion(body: string, hit: ComplianceHit): string {
  if (!hit.suggestion || !hit.word) return body;
  // 仅替换首次出现；复杂建议留给作者手改
  if (hit.suggestion.length <= 24 && !/删|回避|淡化|弱化|删除/.test(hit.suggestion)) {
    return body.replace(hit.word, hit.suggestion);
  }
  return body.replace(hit.word, `【${hit.suggestion}】`);
}

export async function runBookCompliance(
  root: string,
  join: (...p: string[]) => Promise<string>,
  opts?: { limitChapters?: number }
): Promise<ComplianceHit[]> {
  if (!window.moshu) return [];
  const { buildChapterIndex } = await import("./chapterFiles");
  const { loadProjectProgress } = await import("./projectProgress");
  const rules = await loadComplianceRules(root, join);
  const prog = await loadProjectProgress(root, join);
  const files = await window.moshu.listDir(await join(root, "chapters"));
  const byId = buildChapterIndex(files);
  const rows = prog.chapterRows.filter((r) => r.hasChapter);
  const limit = opts?.limitChapters || 9999;
  const all: ComplianceHit[] = [];
  for (const row of rows.slice(0, limit)) {
    const f = byId.get(row.id);
    if (!f) continue;
    try {
      const body = await window.moshu.readText(f.path);
      for (const h of scanCompliance(body, rules)) {
        all.push({ ...h, chapterId: row.id, chapterTitle: row.title });
      }
    } catch {
      /* skip */
    }
  }
  const order: Record<ComplianceLevel, number> = { 高危: 0, 中: 1, 建议: 2 };
  all.sort((a, b) => order[a.level] - order[b.level]);
  return all;
}

export function complianceRiskScore(hits: ComplianceHit[]): {
  score: number;
  max: number;
  detail: string;
} {
  const high = hits.filter((h) => h.level === "高危").length;
  const mid = hits.filter((h) => h.level === "中").length;
  const soft = hits.filter((h) => h.level === "建议").length;
  // 20 分制：高危每条 -4，中 -2，建议 -0.5
  let score = 20;
  score -= high * 4 + mid * 2 + soft * 0.5;
  score = Math.max(0, Math.round(score));
  return {
    score,
    max: 20,
    detail:
      hits.length === 0
        ? "未检出过审风险词"
        : `高危 ${high} · 中 ${mid} · 建议 ${soft}`,
  };
}
