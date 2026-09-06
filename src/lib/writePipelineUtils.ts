import { countTextWords } from "./projectProgress";

export const DEFAULT_MIN_RATIO = 0.9;
export const DEFAULT_MAX_RATIO = 1.15;

export function wordGateStatus(
  wordsNow: number,
  target: number,
  minRatio = DEFAULT_MIN_RATIO,
  maxRatio = DEFAULT_MAX_RATIO
): "under" | "ok" | "over" {
  if (target <= 0) return "ok";
  const r = wordsNow / target;
  if (r < minRatio) return "under";
  if (r > maxRatio) return "over";
  return "ok";
}

/** 中文约 2 token/字 + 40% 缓冲，夹在 2048～32000 */
export function estimateMaxTokens(targetChars: number): number {
  const n = Math.max(200, targetChars);
  return Math.min(32000, Math.max(2048, Math.ceil(n * 2 * 1.4)));
}

export function parseTargetWordsFromTranscript(text: string): number | null {
  const matches = [
    ...text.matchAll(/(?:约|目标|写到|写至|不少于)?\s*(\d{3,5})\s*字/g),
  ];
  if (!matches.length) return null;
  const n = Number(matches[matches.length - 1][1]);
  return n >= 500 && n <= 20000 ? n : null;
}

export function resolveChapterTargetWords(
  transcript: string,
  toolbarTarget?: number,
  defaultTarget?: number
): number {
  return (
    parseTargetWordsFromTranscript(transcript) ??
    toolbarTarget ??
    defaultTarget ??
    2500
  );
}

export type SceneBudget = { title: string; budget: number };

export function parseScenePlan(markdown: string): SceneBudget[] {
  const lines = markdown.split(/\r?\n/);
  const out: SceneBudget[] = [];
  for (const line of lines) {
    const m = line.match(
      /(?:^\s*(?:\d+[\.\)、]|[-*•])\s*)?(.+?)[｜|：:\s]+(\d{2,5})\s*$/
    );
    if (!m) continue;
    const title = m[1].replace(/^[#*\s]+/, "").trim();
    const budget = Number(m[2]);
    if (
      title &&
      budget > 0 &&
      !/^(?:总计|合计|共计|小计|总和|合计字数)$/i.test(title)
    ) {
      out.push({ title, budget });
    }
  }
  return out;
}

export function reportHasMissingBeats(report: string): boolean {
  const section =
    report.match(/#{1,6}\s*缺失或偏离[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/)?.[1]?.trim() ||
    "";
  if (!section) return false;
  const lines = section
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  if (!lines.length) return false;
  return lines.some(
    (line) =>
      !/^(?:本章\s*)?(?:无|没有|未见|未发现|均已覆盖|不适用)/i.test(line)
  );
}

export function isWholeChapterReplacementSane(
  oldBody: string,
  newBody: string
): boolean {
  if (!newBody.trim()) return false;
  return countTextWords(newBody) >= countTextWords(oldBody) * 0.8;
}

export function fallbackScenePlan(beats: string, targetWords: number): SceneBudget[] {
  const titles: string[] = [];
  for (const line of beats.split(/\r?\n/)) {
    const t = line.replace(/^[-*#\s\d.、)（）]+/, "").trim();
    if (t.length >= 2 && t.length <= 40) titles.push(t);
  }
  const base =
    titles.length >= 3
      ? titles.slice(0, 8)
      : ["开场", "冲突推进", "转折", "收束与钩子"];
  const n = base.length;
  const each = Math.floor(targetWords / n);
  const plan = base.map((title, i) => ({
    title,
    budget: i === n - 1 ? targetWords - each * (n - 1) : each,
  }));
  return plan;
}

export function normalizePlanBudgets(plan: SceneBudget[], targetWords: number): SceneBudget[] {
  if (!plan.length) return fallbackScenePlan("", targetWords);
  const sum = plan.reduce((a, b) => a + b.budget, 0);
  if (sum <= 0) return fallbackScenePlan(plan.map((p) => p.title).join("\n"), targetWords);
  return plan.map((p, i) => ({
    title: p.title,
    budget:
      i === plan.length - 1
        ? Math.max(
            100,
            targetWords -
              plan
                .slice(0, -1)
                .reduce((a, x) => a + Math.max(100, Math.round((x.budget / sum) * targetWords)), 0)
          )
        : Math.max(100, Math.round((p.budget / sum) * targetWords)),
  }));
}
