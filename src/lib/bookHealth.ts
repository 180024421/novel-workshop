/** 本书健康分：细纲覆盖、开放钩子、工艺病密度、缺摘要、过审风险 */

import { listBackups } from "./backup";
import { buildChapterIndex } from "./chapterFiles";
import {
  complianceRiskScore,
  loadComplianceRules,
  scanCompliance,
} from "./compliance";
import { loadHooksLedger } from "./hooksLedger";
import { loadProjectProgress, type ProjectProgress } from "./projectProgress";
import { scanCraftIssues } from "./scan";
import { loadSummaries } from "./summaries";

export type HealthDimension = {
  id: "beats" | "hooks" | "craft" | "summaries" | "compliance";
  label: string;
  score: number;
  max: number;
  detail: string;
  hintTo?: string;
};

export type BookHealthReport = {
  score: number;
  grade: "优" | "良" | "中" | "弱";
  dimensions: HealthDimension[];
  openHooks: number;
  missingSummaries: number;
  chaptersWithBody: number;
  craftHitsSample: number;
  craftSampleChapters: number;
  complianceHitsSample?: number;
};

function gradeOf(score: number): BookHealthReport["grade"] {
  if (score >= 85) return "优";
  if (score >= 70) return "良";
  if (score >= 50) return "中";
  return "弱";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreFromProgress(opts: {
  prog: ProjectProgress;
  openHooks: number;
  chaptersWithSummary: number;
  craftHits: number;
  craftSampleWords: number;
  craftSampleChapters: number;
  complianceHits?: number;
  complianceScore?: number;
  complianceDetail?: string;
}): BookHealthReport {
  const { prog } = opts;
  const withBody = prog.chapterRows.filter((r) => r.hasChapter && r.words > 0);
  const chaptersWithBody = withBody.length;
  const listed = Math.max(1, prog.chapterTotal || prog.chapterRows.length || 1);

  const beatsCovered = prog.chapterRows.filter((r) => r.hasBeats).length;
  const beatsRatio = beatsCovered / listed;
  const beatsScore = Math.round(beatsRatio * 20);

  const openHooks = Math.max(0, opts.openHooks);
  let hooksScore = 20;
  if (openHooks === 0 && chaptersWithBody > 2) hooksScore = 14;
  else if (openHooks > 20) hooksScore = 6;
  else if (openHooks > 12) hooksScore = 12;
  else if (openHooks > 8) hooksScore = 16;

  const density =
    opts.craftSampleWords > 0
      ? opts.craftHits / Math.max(1, opts.craftSampleWords / 1000)
      : 0;
  const craftScore = Math.round(clamp(20 - density * (20 / 8), 0, 20));

  const needSummary = Math.max(0, chaptersWithBody);
  const haveSummary = Math.min(needSummary, opts.chaptersWithSummary);
  const summaryRatio = needSummary ? haveSummary / needSummary : 1;
  const summariesScore = Math.round(summaryRatio * 20);
  const missingSummaries = Math.max(0, needSummary - haveSummary);

  const complianceScore =
    opts.complianceScore != null ? opts.complianceScore : 20;
  const complianceDetail =
    opts.complianceDetail ||
    (opts.complianceHits
      ? `抽检命中 ${opts.complianceHits} 处`
      : "未抽检");

  const dimensions: HealthDimension[] = [
    {
      id: "beats",
      label: "细纲覆盖",
      score: beatsScore,
      max: 20,
      detail: `${beatsCovered}/${listed} 章有细纲`,
      hintTo: "/app/beats",
    },
    {
      id: "hooks",
      label: "开放钩子",
      score: hooksScore,
      max: 20,
      detail: `未解钩子 ${openHooks} 条`,
      hintTo: "/app/chapter",
    },
    {
      id: "craft",
      label: "工艺病密度",
      score: craftScore,
      max: 20,
      detail:
        opts.craftSampleChapters > 0
          ? `近 ${opts.craftSampleChapters} 章抽检约 ${opts.craftHits} 处（每千字 ${density.toFixed(1)}）`
          : "暂无正文可抽检",
      hintTo: "/app/chapter",
    },
    {
      id: "summaries",
      label: "章摘要",
      score: summariesScore,
      max: 20,
      detail: needSummary
        ? `已有摘要 ${haveSummary}/${needSummary}，缺 ${missingSummaries}`
        : "尚无正文",
      hintTo: "/app/summaries",
    },
    {
      id: "compliance",
      label: "过审风险",
      score: complianceScore,
      max: 20,
      detail: complianceDetail,
      hintTo: "/app/compliance",
    },
  ];

  const score = dimensions.reduce((s, d) => s + d.score, 0);
  return {
    score,
    grade: gradeOf(score),
    dimensions,
    openHooks,
    missingSummaries,
    chaptersWithBody,
    craftHitsSample: opts.craftHits,
    craftSampleChapters: opts.craftSampleChapters,
    complianceHitsSample: opts.complianceHits || 0,
  };
}

export async function computeBookHealth(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<BookHealthReport> {
  const prog = await loadProjectProgress(root, join);
  const hooks = await loadHooksLedger(root, join);
  const openHooks = (hooks.items || []).filter((h) => h.status === "open").length;
  const summaries = await loadSummaries(root, join);
  const summaryIds = new Set((summaries.items || []).map((s) => s.chapterId));
  const withBody = prog.chapterRows.filter((r) => r.hasChapter && r.words > 0);
  const chaptersWithSummary = withBody.filter((r) => summaryIds.has(r.id)).length;

  let craftHits = 0;
  let craftSampleWords = 0;
  let craftSampleChapters = 0;
  let complianceHits = 0;
  let complianceScore = 20;
  let complianceDetail = "暂无正文可抽检";
  if (window.moshu) {
    const files = await window.moshu.listDir(await join(root, "chapters"));
    const byId = buildChapterIndex(files);
    const rules = await loadComplianceRules(root, join);
    const sample = withBody.slice(-5);
    const compAccum: ReturnType<typeof scanCompliance> = [];
    for (const row of sample) {
      const hit = byId.get(row.id);
      if (!hit) continue;
      try {
        const body = await window.moshu.readText(hit.path);
        if (!body.trim()) continue;
        craftHits += scanCraftIssues(body).length;
        craftSampleWords += body.replace(/\s+/g, "").length;
        craftSampleChapters += 1;
        compAccum.push(...scanCompliance(body, rules));
      } catch {
        /* skip */
      }
    }
    complianceHits = compAccum.length;
    const risk = complianceRiskScore(compAccum);
    complianceScore = risk.score;
    complianceDetail =
      craftSampleChapters > 0
        ? `近 ${craftSampleChapters} 章：${risk.detail}`
        : risk.detail;
  }

  return scoreFromProgress({
    prog,
    openHooks,
    chaptersWithSummary,
    craftHits,
    craftSampleWords,
    craftSampleChapters,
    complianceHits,
    complianceScore,
    complianceDetail,
  });
}

/** 检测本书是否已含工艺红线（style/taboo） */
export async function projectHasCraftRules(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<boolean> {
  if (!window.moshu) return false;
  try {
    const style = await window.moshu.readText(await join(root, "prompts", "style.md"));
    const taboo = await window.moshu.readText(await join(root, "prompts", "taboo.md"));
    return /写作工艺|禁止（正文|工艺红线/.test(style) || taboo.trim().length > 40;
  } catch {
    return false;
  }
}

export async function revisionDiskStats(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<{ count: number; approxWords: number }> {
  const list = await listBackups(root, join);
  let approxWords = 0;
  for (const b of list.slice(0, 30)) {
    approxWords += b.words || 0;
  }
  return { count: list.length, approxWords };
}
