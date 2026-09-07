/** 跨章一致性检查（摘要 + 实体 + 钩子 → 单次 LLM） */

import { loadCharactersMarkdown } from "./characters";
import { loadEntities, formatEntitiesForPrompt } from "./entities";
import { chatCompletion } from "./gateway";
import { formatOpenHooksForPrompt, loadHooksLedger } from "./hooksLedger";
import { SYSTEM_WRITER } from "./prompts";
import type { ProviderConfig } from "./providerPresets";
import { loadSummaries } from "./summaries";
import type { AppSettings } from "../types";

export type ConsistencyIssue = {
  chapterId: string;
  kind: string;
  detail: string;
};

export function buildConsistencyPrompt(opts: {
  summariesBlock: string;
  entitiesBlock: string;
  hooksBlock: string;
  charactersBlock: string;
}): string {
  return `请做「跨章一致性」诊断，只基于给定材料，输出 Markdown（不要代码围栏）：

## 摘要
一两句总评。

## 问题列表
每行一条，格式严格：
- 章号｜类别｜说明
类别用：人物状态 / 时间线 / 器物 / 地理 / 伏笔 / 其他

不确定处写「待核实」。不要改正文。

# 章摘要
${opts.summariesBlock.slice(0, 12000) || "（无摘要——请提示作者先补章摘要）"}

# 实体卡
${opts.entitiesBlock.slice(0, 6000) || "（无实体卡）"}

# 开放钩子
${opts.hooksBlock || "（无）"}

# 人物卡摘要
${opts.charactersBlock.slice(0, 6000) || "（无）"}
`;
}

export function parseConsistencyIssues(raw: string): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  for (const line of (raw || "").split(/\r?\n/)) {
    const m = line.match(
      /^[-*•]\s*(第?\d+章)?\s*[｜|]\s*([^｜|]+)\s*[｜|]\s*(.+)$/
    );
    if (!m) continue;
    issues.push({
      chapterId: (m[1] || "").trim() || "未知",
      kind: m[2].trim(),
      detail: m[3].trim(),
    });
  }
  return issues;
}

export async function runConsistencyCheck(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  settings: AppSettings;
  providers: ProviderConfig[];
  signal?: AbortSignal;
}): Promise<{ report: string; path: string; issues: ConsistencyIssue[]; missingSummaries: number }> {
  if (!window.moshu) throw new Error("桌面端未就绪");

  const summaries = await loadSummaries(opts.root, opts.join);
  const items = summaries.items || [];
  const missingSummaries = Math.max(0, 0); // caller may compare with prog
  const summariesBlock = items
    .slice(-40)
    .map((s) => `### ${s.chapterId} ${s.title}\n${s.summary}`)
    .join("\n\n");

  if (items.length < 2) {
    const tip =
      "# 一致性检查\n\n摘要不足（少于 2 章）。请先到「章摘要」补齐或开启写章后自动摘要，再回来检查。\n";
    const path = await opts.join(opts.root, "continuity", "consistency-check.md");
    await window.moshu.writeText(path, tip);
    return { report: tip, path, issues: [], missingSummaries: 2 - items.length };
  }

  const entities = await loadEntities(opts.root, opts.join);
  const entitiesBlock = formatEntitiesForPrompt(entities);
  const hooks = await loadHooksLedger(opts.root, opts.join);
  const hooksBlock = formatOpenHooksForPrompt(hooks, 40);
  const charactersBlock = await loadCharactersMarkdown(opts.root, opts.join);

  const prompt = buildConsistencyPrompt({
    summariesBlock,
    entitiesBlock,
    hooksBlock,
    charactersBlock,
  });

  const report = await chatCompletion(
    opts.settings,
    [
      { role: "system", content: SYSTEM_WRITER },
      { role: "user", content: prompt },
    ],
    { providers: opts.providers, signal: opts.signal, temperature: 0.3 }
  );

  const path = await opts.join(opts.root, "continuity", "consistency-check.md");
  await window.moshu.writeText(path, report);
  return {
    report,
    path,
    issues: parseConsistencyIssues(report),
    missingSummaries,
  };
}
