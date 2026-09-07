/** 连载排期：存稿与断更风险 */

import type { ProjectProgress } from "./projectProgress";
import type { UsageStore } from "./usageLedger";

export type SerialPlan = {
  /** 已发布到第几章，如 第12章 */
  publishedThrough: string;
  /** 日更章数，默认 1 */
  dailyChapters: number;
  startDate: string;
  updatedAt: string;
};

export type SerialRisk = "稳" | "紧" | "危";

export type SerialStatus = {
  publishedThrough: string;
  publishedNum: number;
  writtenCount: number;
  bufferChapters: number;
  dailyChapters: number;
  daysCovered: number;
  risk: SerialRisk;
  hint: string;
};

const emptyPlan = (): SerialPlan => ({
  publishedThrough: "第0章",
  dailyChapters: 1,
  startDate: new Date().toISOString().slice(0, 10),
  updatedAt: new Date().toISOString(),
});

export function chapterNum(id: string): number {
  return Number(String(id).match(/\d+/)?.[0] || 0);
}

export async function loadSerialPlan(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<SerialPlan> {
  if (!window.moshu) return emptyPlan();
  const path = await join(root, "continuity", "serial.json");
  const data = await window.moshu.readJson<Partial<SerialPlan>>(path, {});
  return {
    publishedThrough: data.publishedThrough || "第0章",
    dailyChapters: Math.max(1, Number(data.dailyChapters) || 1),
    startDate: data.startDate || emptyPlan().startDate,
    updatedAt: data.updatedAt || emptyPlan().updatedAt,
  };
}

export async function saveSerialPlan(
  root: string,
  join: (...p: string[]) => Promise<string>,
  plan: SerialPlan
): Promise<void> {
  if (!window.moshu) return;
  const next = { ...plan, updatedAt: new Date().toISOString() };
  await window.moshu.writeJson(await join(root, "continuity", "serial.json"), next);
}

export function computeSerialStatus(
  prog: ProjectProgress | null,
  plan: SerialPlan,
  _usage?: UsageStore | null
): SerialStatus {
  void _usage;
  const publishedNum = chapterNum(plan.publishedThrough);
  const written = (prog?.chapterRows || []).filter((r) => r.hasChapter && r.words > 0);
  const writtenCount = written.length;
  const maxWritten = written.reduce((m, r) => Math.max(m, chapterNum(r.id)), 0);
  const bufferChapters = Math.max(0, maxWritten - publishedNum);
  const daily = Math.max(1, plan.dailyChapters || 1);
  const daysCovered = Math.floor(bufferChapters / daily);

  let risk: SerialRisk = "稳";
  let hint = `存稿约 ${bufferChapters} 章，按日更 ${daily} 章可撑约 ${daysCovered} 天`;
  if (bufferChapters < 3) {
    risk = "危";
    hint = `存稿仅 ${bufferChapters} 章（建议≥3），有断更风险`;
  } else if (bufferChapters < daily * 5) {
    risk = "紧";
    hint = `存稿 ${bufferChapters} 章，不足约 5 天日更量`;
  }

  return {
    publishedThrough: plan.publishedThrough,
    publishedNum,
    writtenCount,
    bufferChapters,
    dailyChapters: daily,
    daysCovered,
    risk,
    hint,
  };
}
