# Write Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现质量优先的七步正文写作流水线，使目标字数达标（默认 90%～115%），并带细纲自检与连贯润色；工具栏 / 批量 / Agent 共用。

**Architecture:** 新建 `writePipeline.ts` 编排七步 LLM 调用；纯函数（字数门禁、计划解析、maxTokens、对话字数）可单测；`writeOneChapter` 与 Studio chapter 生成改为调用编排器；设置项控制开关。

**Tech Stack:** TypeScript、React、Vitest、现有 `chatCompletion` / `withRetry` / Electron 本地文件。

**Spec:** `docs/superpowers/specs/2026-09-06-write-pipeline-design.md`

## Global Constraints

- 本地书稿模型；无云同步 / 多人协作
- 无细纲拒绝写章
- 可 Abort；已写正文保留
- 固定七步编排，不用自由 tool-calling
- 不计 token；`maxTokens` 按目标字数动态估算
- `novel-workshop` 若无 `.git`，所有 Commit 步骤改为「跳过」

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/writePipelineUtils.ts` | 纯函数：达标判断、续写轮次、maxTokens、对话字数解析、场次计划解析 |
| `src/lib/writePipelineUtils.test.ts` | 上述纯函数单测 |
| `src/lib/writePipelinePrompts.ts` | 流水线各步 prompt 字符串 |
| `src/lib/writePipeline.ts` | `runWritePipeline` 编排与进度回调 |
| `src/lib/prompts.ts` | 强化 `chapterPrompt` 硬字数（legacy / 关闭流水线时） |
| `src/types.ts` | `AppSettings` 流水线字段 |
| `src/lib/chapterWrite.ts` | `writeOneChapter` 走 pipeline 或 legacy |
| `src/components/ChapterTools.tsx` | 进度文案 + 终检摘要 |
| `src/pages/StudioPage.tsx` | chapter 的 `generateFromChat` 走 pipeline |
| `src/pages/SettingsPage.tsx` | 流水线设置 UI |
| `src/pages/BatchPage.tsx` / `QuickStartPage.tsx` / `StatusPage.tsx` | 传入目标字数 / 进度 |
| `src/styles.css` | 进度条 / 终检面板样式 |

---

### Task 1: 纯工具函数 + 单测

**Files:**
- Create: `src/lib/writePipelineUtils.ts`
- Create: `src/lib/writePipelineUtils.test.ts`

**Interfaces:**
- Produces:
  - `wordGateStatus(wordsNow, target, minRatio, maxRatio): "under" | "ok" | "over"`
  - `estimateMaxTokens(targetChars: number): number`
  - `parseTargetWordsFromTranscript(text: string): number | null`
  - `parseScenePlan(markdown: string): { title: string; budget: number }[]`
  - `fallbackScenePlan(beats: string, targetWords: number): { title: string; budget: number }[]`
  - `DEFAULT_MIN_RATIO = 0.9`, `DEFAULT_MAX_RATIO = 1.15`

- [ ] **Step 1: 写失败单测**

```ts
// src/lib/writePipelineUtils.test.ts
import { describe, expect, it } from "vitest";
import {
  wordGateStatus,
  estimateMaxTokens,
  parseTargetWordsFromTranscript,
  parseScenePlan,
  fallbackScenePlan,
} from "./writePipelineUtils";

describe("writePipelineUtils", () => {
  it("wordGateStatus under/ok/over", () => {
    expect(wordGateStatus(700, 2500, 0.9, 1.15)).toBe("under");
    expect(wordGateStatus(2300, 2500, 0.9, 1.15)).toBe("ok");
    expect(wordGateStatus(3000, 2500, 0.9, 1.15)).toBe("over");
  });

  it("estimateMaxTokens scales with target", () => {
    expect(estimateMaxTokens(2500)).toBeGreaterThanOrEqual(6000);
    expect(estimateMaxTokens(5000)).toBeGreaterThan(estimateMaxTokens(2500));
  });

  it("parseTargetWordsFromTranscript", () => {
    expect(parseTargetWordsFromTranscript("请写约2500字")).toBe(2500);
    expect(parseTargetWordsFromTranscript("目标 3000 字左右")).toBe(3000);
    expect(parseTargetWordsFromTranscript("随便聊聊")).toBeNull();
  });

  it("parseScenePlan from markdown list", () => {
    const md = `1. 开场｜800\n2. 冲突｜1000\n3. 收束｜700`;
    const plan = parseScenePlan(md);
    expect(plan.length).toBe(3);
    expect(plan[0].budget).toBe(800);
    expect(plan.map((p) => p.budget).reduce((a, b) => a + b, 0)).toBe(2500);
  });

  it("fallbackScenePlan splits target", () => {
    const plan = fallbackScenePlan("## 场次\n- 开场\n- 冲突\n- 收束", 2400);
    expect(plan.length).toBeGreaterThanOrEqual(3);
    const sum = plan.reduce((a, b) => a + b.budget, 0);
    expect(sum).toBe(2400);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

Run: `npm test -- src/lib/writePipelineUtils.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

```ts
// src/lib/writePipelineUtils.ts
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
    if (title && budget > 0) out.push({ title, budget });
  }
  return out;
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
```

- [ ] **Step 4: 跑测通过**

Run: `npm test -- src/lib/writePipelineUtils.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit（有 git 才执行）**

```bash
git add src/lib/writePipelineUtils.ts src/lib/writePipelineUtils.test.ts
git commit -m "test: add write pipeline pure helpers"
```

---

### Task 2: 流水线 Prompt 模块

**Files:**
- Create: `src/lib/writePipelinePrompts.ts`
- Modify: `src/lib/prompts.ts` — 强化 `chapterPrompt` 硬区间文案（legacy）

**Interfaces:**
- Consumes: `SceneBudget` from utils
- Produces: `briefPrompt`, `planPrompt`, `scenePrompt`, `continuePrompt`, `compressPrompt`, `beatsFixPrompt`, `polishPrompt`

- [ ] **Step 1: 实现 prompts**

```ts
// src/lib/writePipelinePrompts.ts
import type { SceneBudget } from "./writePipelineUtils";

export function briefPrompt(ctx: {
  beats: string;
  bible: string;
  characters: string;
  style: string;
  prevTail: string;
  hooks: string;
  targetWords: number;
}) {
  return `根据材料写「本章写作简报」（短，供后续分场写作用）。输出 Markdown：
## 冲突核
## 情绪弧
## 必写点（条目）
## 禁踩雷
不要写正文。目标全章约 ${ctx.targetWords} 字。

细纲：
${ctx.beats.slice(0, 8000)}
设定：
${ctx.bible.slice(0, 4000)}
人物：
${ctx.characters.slice(0, 3000)}
风格：
${ctx.style.slice(0, 1500)}
上章末：
${ctx.prevTail.slice(-1500) || "（开篇）"}
${ctx.hooks}`;
}

export function planPrompt(ctx: {
  brief: string;
  beats: string;
  targetWords: number;
}) {
  return `把本章拆成 3～8 个场次，并分配字数预算，总和必须等于 ${ctx.targetWords}。
每行格式严格：\`序号. 场次标题｜预算整数\`
只输出场次列表，不要解释。

简报：
${ctx.brief.slice(0, 4000)}
细纲：
${ctx.beats.slice(0, 6000)}`;
}

export function scenePrompt(ctx: {
  brief: string;
  scene: SceneBudget;
  sceneIndex: number;
  sceneTotal: number;
  prevSceneTail: string;
  characters: string;
  style: string;
  isFirst: boolean;
  chapterTitle: string;
  chapterId: string;
}) {
  return `写本章第 ${ctx.sceneIndex}/${ctx.sceneTotal} 场「${ctx.scene.title}」正文。
硬性：本场约 ${ctx.scene.budget} 字（务必写到该预算的 90% 以上再收束）；只输出本场正文 Markdown，不要解说。
${ctx.isFirst ? `章标题行：# ${ctx.chapterId} ${ctx.chapterTitle}` : "不要重复章标题；直接从本场接着写。"}
过程戏写全，对白有声口，环境有感官。

简报：
${ctx.brief.slice(0, 3000)}
人物声口：
${ctx.characters.slice(0, 2500)}
风格：
${ctx.style.slice(0, 1200)}
上一场末尾（承接，勿重演）：
${ctx.prevSceneTail.slice(-800) || "（本场开篇）"}`;
}

export function continuePrompt(ctx: {
  body: string;
  wordsNow: number;
  targetWords: number;
  gap: number;
  brief: string;
}) {
  return `下面正文目前约 ${ctx.wordsNow} 字，目标 ${ctx.targetWords} 字，还差约 ${ctx.gap} 字。
从断点继续写，补足缺口；禁止复述已写情节；只输出续写部分（不要重复已有正文）。

简报：
${ctx.brief.slice(0, 2000)}
已有正文末尾：
${ctx.body.slice(-2500)}`;
}

export function compressPrompt(ctx: {
  body: string;
  wordsNow: number;
  targetWords: number;
}) {
  return `正文约 ${ctx.wordsNow} 字，超过目标 ${ctx.targetWords}。轻度压缩冗余描写，保留冲突、对白与章末钩子。
目标压缩到约 ${ctx.targetWords} 字。只输出压缩后的完整正文 Markdown。

原文：
${ctx.body.slice(0, 28000)}`;
}

export function beatsFixPrompt(ctx: {
  beats: string;
  body: string;
  checkReport: string;
}) {
  return `根据「缺失或偏离」补写正文中缺的部分。只输出需要插入/替换的补写段落（可多段），不要重写全章，不要解释。

细纲：
${ctx.beats.slice(0, 5000)}
自检报告：
${ctx.checkReport.slice(0, 4000)}
现有正文（参考）：
${ctx.body.slice(0, 12000)}`;
}

export function polishPrompt(ctx: {
  body: string;
  prevTail: string;
  bible: string;
  characters: string;
}) {
  return `润色本章：修正与上章衔接、人名漂移、设定矛盾、声口崩坏。保持情节与字数大致不变。只输出润色后完整正文。

上章末：
${ctx.prevTail.slice(-1800) || "（开篇）"}
设定：
${ctx.bible.slice(0, 3000)}
人物：
${ctx.characters.slice(0, 2500)}
正文：
${ctx.body.slice(0, 28000)}`;
}
```

同时改 `chapterPrompt` 首句为硬区间（`约 ${words} 字` → `目标 ${words} 字，务必写到 ${Math.round(words*0.9)}～${Math.round(words*1.15)} 字，过程戏写全，禁止草草收尾`）。

- [ ] **Step 2: Commit（有 git 才执行）**

```bash
git add src/lib/writePipelinePrompts.ts src/lib/prompts.ts
git commit -m "feat: add write pipeline prompts and harden chapterPrompt"
```

---

### Task 3: `runWritePipeline` 编排器

**Files:**
- Create: `src/lib/writePipeline.ts`

**Interfaces:**
- Consumes: utils、prompts、`chatCompletion`、`withRetry`、`countTextWords`、`beatsCheckPrompt`（现有）、`loadChapterBeatsText`、人物/KB/钩子加载（复用 `chapterWrite` 同款上下文加载逻辑，可抽 `loadChapterWriteContext` 或内联复制后收敛）
- Produces:

```ts
export type WritePipelinePhase =
  | "brief" | "plan" | "scene" | "wordgate" | "beats_check" | "polish" | "report" | "done" | "error";

export type WritePipelineProgress = {
  phase: WritePipelinePhase;
  label: string;
  sceneIndex?: number;
  sceneTotal?: number;
  wordsNow?: number;
  wordsTarget?: number;
  bodySoFar?: string;
};

export type WritePipelineResult = {
  body: string;
  words: number;
  targetWords: number;
  ratio: number;
  continueRounds: number;
  beatsReport: string;
  phaseLog: string[];
};

export async function runWritePipeline(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  chapterId: string;
  chapterTitle: string;
  settings: AppSettings;
  providers: ProviderConfig[];
  targetWords: number;
  signal?: AbortSignal;
  onProgress?: (p: WritePipelineProgress) => void;
  /** false 时跳过落盘（Studio 仅写编辑器时可由调用方落盘） */
  persist?: boolean;
  extractHooks?: boolean;
}): Promise<WritePipelineResult>
```

- [ ] **Step 1: 实现编排逻辑（按 spec 七步）**

要点：
1. 若 `settings.writePipelineEnabled === false`，调用方应走 legacy（本函数假定 enabled）。
2. 加载上下文（细纲为空则 `throw`）。
3. brief → plan（parse 失败用 `fallbackScenePlan` + `normalizePlanBudgets`）。
4. 逐场 `scenePrompt`，`onProgress` 带 `bodySoFar`；`maxTokens: estimateMaxTokens(scene.budget)`。
5. wordgate：under 最多续写 3 次；over 一次 compress。
6. beats_check：`beatsCheckPrompt` + 若报告含「缺失」则 `beatsFixPrompt` 最多 2 轮（把补写 append 到正文末，或让模型输出完整章——**采用 append 补写段** 更稳）。
7. polish：`polishPrompt`，`routeCheck`。
8. persist 默认 true：写 `chapters/{id}_{title}.md` + 钩子抽取（复制 `writeOneChapter` 落盘逻辑）。
9. 每步 `withRetry({ retries: 2 })`；Abort 向上抛。

撰写步 model：`settings.routeChapter`；检查/润色：`settings.routeCheck`。

- [ ] **Step 2: `npx tsc -b --pretty false` 无本文件类型错误**

- [ ] **Step 3: Commit（有 git 才执行）**

```bash
git add src/lib/writePipeline.ts
git commit -m "feat: add runWritePipeline orchestrator"
```

---

### Task 4: 设置项 + `writeOneChapter` 接入

**Files:**
- Modify: `src/types.ts` — `AppSettings` 增加流水线字段
- Modify: `src/lib/chapterWrite.ts` — `writeOneChapter` 调用 pipeline
- Modify: `src/pages/SettingsPage.tsx` — UI
- Modify: `src/pages/StatusPage.tsx` — 重试传入 `defaultChapterWords` / 2500

**Interfaces:**
- Settings defaults:
  - `writePipelineEnabled?: boolean` default true
  - `writePipelineWordGate?: boolean` default true
  - `writePipelineBeatsCheck?: boolean` default true
  - `writePipelinePolish?: boolean` default true
  - `writePipelineMinRatio?: number` default 0.9
  - `writePipelineMaxRatio?: number` default 1.15
  - `defaultChapterWords?: number` default 2500

- [ ] **Step 1: 扩展 `AppSettings`**

- [ ] **Step 2: `writeOneChapter`**

```ts
// 伪代码
if (opts.settings.writePipelineEnabled !== false) {
  const result = await runWritePipeline({ ...opts, targetWords: opts.targetWords ?? opts.settings.defaultChapterWords ?? 2500, persist: true, onProgress: (p) => opts.onDelta && p.bodySoFar != null ? /* 全量刷 */ : undefined });
  // onDelta 现为增量；pipeline 用 onProgress.bodySoFar 全量时，ChapterTools 需改为支持 onProgress 或每次 setDoc(bodySoFar)
  return result.body;
}
// else legacy 单次 chapterPrompt（强化字数文案）
```

**注意：** 现有 `onDelta` 是增量拼接。流水线应新增可选 `onProgress`，`ChapterTools` 改为：

```ts
onProgress: (p) => {
  if (p.bodySoFar != null) setDoc(p.bodySoFar);
  onHint(p.label);
}
```

`writeOneChapter` 签名增加 `onProgress?: (p: WritePipelineProgress) => void`。

- [ ] **Step 3: SettingsPage「写作流水线」折叠区**：总开关、字数门禁、细纲自检、润色、默认章字数、达标% 说明。

- [ ] **Step 4: StatusPage `writeOneChapter` 传 `targetWords: settings.defaultChapterWords ?? 2500`**

- [ ] **Step 5: Commit（有 git 才执行）**

```bash
git add src/types.ts src/lib/chapterWrite.ts src/pages/SettingsPage.tsx src/pages/StatusPage.tsx
git commit -m "feat: wire write pipeline into settings and writeOneChapter"
```

---

### Task 5: ChapterTools / Batch / QuickStart UI

**Files:**
- Modify: `src/components/ChapterTools.tsx`
- Modify: `src/pages/BatchPage.tsx`
- Modify: `src/pages/QuickStartPage.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: ChapterTools** — `writeChapter` 用 `onProgress` 更新 hint；完成后展示终检：`已写入 约 W 字（目标 T，达标率 R%；自检见工具区）`；可选折叠显示 `beatsReport` 摘要。

- [ ] **Step 2: Batch** — `runBatchWrite` 进度日志改为含字数；`writeOneChapter` 已走 pipeline 则日志自然含实写字数（已有）。确认 `targetWords` 传入。

- [ ] **Step 3: QuickStart** — `targetWords: settings.defaultChapterWords ?? 2000`（或 2500 与默认一致）。

- [ ] **Step 4: CSS** — `.studio-pipeline-progress` 状态行样式（不必花哨）。

- [ ] **Step 5: Commit（有 git 才执行）**

```bash
git add src/components/ChapterTools.tsx src/pages/BatchPage.tsx src/pages/QuickStartPage.tsx src/styles.css
git commit -m "feat: show pipeline progress in chapter tools and batch"
```

---

### Task 6: Studio Agent 正文走同一流水线

**Files:**
- Modify: `src/pages/StudioPage.tsx`
- Modify: `src/lib/chapterWrite.ts` 或 pipeline — 支持 `persist: false` + 外部 setDoc（已在 Task 3）

- [ ] **Step 1: `generateFromChat` 当 `mode === "chapter"`**

```ts
const target =
  parseTargetWordsFromTranscript(transcript) ??
  /* 若 Studio 能读到 ChapterTools 的 targetWords，优先；否则 */
  settings.defaultChapterWords ??
  2500;

const result = await runWritePipeline({
  root: project.root,
  join,
  chapterId,
  chapterTitle,
  settings,
  providers,
  targetWords: target,
  signal: ac.signal,
  persist: true, // 与写本章一致落盘；同时 setDoc
  onProgress: (p) => {
    setHint(p.label);
    if (p.bodySoFar != null) setDoc(p.bodySoFar);
  },
});
setDoc(result.body);
// assistant 消息附带终检一行
```

非 chapter 模式保持原 `chatCompletion` 逻辑。

- [ ] **Step 2: 若工具栏字数需共享** — 在 `AppContext` 或 props 增加 `chapterTargetWords` 可选；最小改动：Studio 本地 `useState` 与 ChapterTools 同步较难，首版用 `defaultChapterWords` + 对话解析即可；ChapterTools 写章仍用自己的 input。

可选增强：把 `targetWords` 提升到 `StudioPage` state，传给 `ChapterTools`（推荐，体验更好）。

- [ ] **Step 3: 手动验证清单写在 PR/备注**（见验收）

- [ ] **Step 4: Commit（有 git 才执行）**

```bash
git add src/pages/StudioPage.tsx
git commit -m "feat: route agent chapter generate through write pipeline"
```

---

### Task 7: 流水线步骤开关尊重 settings + 回归测试

**Files:**
- Modify: `src/lib/writePipeline.ts` — 尊重 `writePipelineWordGate` / `BeatsCheck` / `Polish` / min/max ratio
- Modify: `src/lib/writePipelineUtils.test.ts` — 补 `normalizePlanBudgets` 测试

- [ ] **Step 1: 编排器读取 settings 跳过关闭的步骤**

- [ ] **Step 2: `npm test` 全绿；`npm run build`（`tsc -b && vite build`）通过**

- [ ] **Step 3: 更新 spec 状态行为「实现中/已实现」待手动验收后勾**

- [ ] **Step 4: Commit（有 git 才执行）**

```bash
git add src/lib/writePipeline.ts src/lib/writePipelineUtils.test.ts docs/superpowers/specs/2026-09-06-write-pipeline-design.md
git commit -m "feat: honor pipeline step toggles and finish write pipeline"
```

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 独立编排器 | T3 |
| 七步 | T3 |
| 字数 90%～115% | T1 + T3 wordgate |
| 硬字数 prompt | T2 |
| 动态 maxTokens | T1 + T3 |
| 设置开关 | T4 + T7 |
| writeOneChapter / 批量 / QuickStart / Status | T4–T5 |
| Agent generateFromChat chapter | T6 |
| 进度 UI | T5–T6 |
| Abort 保留正文 | T3 |
| 规划失败降级 | T3 fallback |
| 关闭流水线 legacy | T4 |
| 验收字数 | 手动（T6/T7） |

## Placeholder Scan

无 TBD；Commit 在无 git 时跳过已写明。

## Type Consistency

- `WritePipelineProgress` / `WritePipelineResult` / `SceneBudget` 名称在 T1–T6 一致
- `onProgress` 全量 `bodySoFar`，不用增量 `onDelta` 作为流水线主路径

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-06-write-pipeline.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务派生子代理，任务间复查  
2. **Inline Execution** — 本会话按 executing-plans 连续做完

Which approach?
