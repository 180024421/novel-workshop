# 正文写作流水线（质量优先）设计

> 已确认：采用独立编排器；不计 token，优先字数达标、细纲覆盖与连贯声口；工具栏 / 批量 / Agent 正文落稿共用。
>
> **状态（2026-09-06）：已实现，等待手动验收。**

## 目标

1. 目标字数与实写字数接近：默认达成率 **≥90% 且 ≤115%**。
2. 正文生成有可观测的多步编排与自检，而不是单次「约 N 字」碰运气。
3. 工具栏「写一章」、批量写、Studio Agent「根据对话生成正文」行为一致、质量一致。
4. 终检可见：字数、达标率、细纲结论、补写次数。

## 约束

- 保持本地文件夹书稿模型；不引入云同步 / 多人协作。
- 无细纲仍拒绝写章（与现网一致），引导用户先到细纲页。
- 可随时 Abort；已生成正文保留在编辑器，不强制丢弃。
- 不采用自由 tool-calling 多 Agent（不稳定）；编排步骤由产品固定。
- 首版不做多模型投票选稿；不做「省 token 快速一稿」（可后续加预设）。

## 问题根因（现状）

- `chapterPrompt` 仅写「约 N 字」软提示；生成后只统计字数，无门禁、无续写。
- `writeOneChapter` 单次 `chatCompletion`；`maxTokens` 固定，未按目标字数换算。
- Agent `generateFromChat`（chapter）不传 `targetWords`。
- 细纲对照 / 连贯检查为手动按钮，不接入自动落稿闭环。

## 架构

### 核心模块

新建 `src/lib/writePipeline.ts`（名称可微调），对外主入口：

```ts
runWritePipeline(opts: WritePipelineOpts): Promise<WritePipelineResult>
```

`writeOneChapter`（`chapterWrite.ts`）改为调用 pipeline（或薄封装），批量与 QuickStart / Status 重试随之受益。

Studio `generateFromChat(mode=chapter)` 改为调用同一 pipeline（目标字数：对话中解析到的字数 > 工具栏目标字数 > 默认 2500）。

### 进度回调

```ts
type WritePipelinePhase =
  | "brief"
  | "plan"
  | "scene"
  | "wordgate"
  | "beats_check"
  | "polish"
  | "report"
  | "done"
  | "error";

type WritePipelineProgress = {
  phase: WritePipelinePhase;
  label: string;           // 状态栏文案
  sceneIndex?: number;
  sceneTotal?: number;
  wordsNow?: number;
  wordsTarget?: number;
  bodySoFar?: string;      // 供流式刷进编辑器
};
```

### 设置项（`AppSettings` 扩展）

| 键 | 默认 | 含义 |
|---|---|---|
| `writePipelineEnabled` | `true` | 总开关；关则回退旧单次 `chapterPrompt` |
| `writePipelineWordGate` | `true` | 字数门禁（续写 / 轻度压缩） |
| `writePipelineBeatsCheck` | `true` | 细纲自检 + 定向补写 |
| `writePipelinePolish` | `true` | 连贯 + 声口润色 |
| `writePipelineMinRatio` | `0.90` | 达标下限 |
| `writePipelineMaxRatio` | `1.15` | 达标上限 |
| `defaultChapterWords` | `2500` | 全书默认章目标字数（工具栏可覆盖） |

设置页提供对应开关与达标区间说明。

## 七步流水线

| # | Phase | 行为 |
|---|---|---|
| 1 | **章前简报 `brief`** | 输入：细纲、人物卡、设定摘要、上章末、开放钩子、作者本章笔记。输出短简报（冲突核 / 情绪弧 / 必写点 / 禁踩雷）。**不写入编辑器**，仅注入后续步骤。 |
| 2 | **场次字数规划 `plan`** | 将目标字数拆到场次；场次过少则自动补开场/冲突/转折/收束。输出结构化计划（场次标题、预算字数、对白占比建议、必出场）。 |
| 3 | **分场撰写 `scene`** | 按序写每一场；上下文含简报、本场预算、上一场末约 400 字、人物声口摘录。流式拼接进编辑器。禁止草草收束未达本场预算。 |
| 4 | **字数门禁 `wordgate`** | `countTextWords` 对比目标。`< minRatio`：按缺口与未写满点定向续写，最多 **3** 轮。`> maxRatio`：轻度压缩冗余，保留冲突与钩子。 |
| 5 | **细纲自检 `beats_check`** | 结构化对照覆盖 / 缺失 / 偏离。有缺失则**只补缺失段**，禁止整章重写。最多 **2** 轮补写后再检一次。 |
| 6 | **连贯+声口润色 `polish`** | 对照上章末与人物卡：人名漂移、设定矛盾、声口崩；局部润色后回写全文。 |
| 7 | **终检报告 `report`** | 侧栏/工具区展示：实写字数、达标率、自检结论摘要、补写次数；落盘章节文件；钩子抽取（沿用现有）。可选：「按建议再补一轮」。 |

## Prompt 与 token 策略

- 硬字数表述：`目标 N 字，务必写到 N×minRatio～N×maxRatio；过程戏写全；禁止未达预算草草收尾。`
- 续写：带当前字数、缺口、已写末尾、禁止复述已写情节、从断点接着写。
- `maxTokens`：按本步目标字数动态估算（中文保守按约 2 token/字 + 缓冲），避免固定 12000 截断短稿或不够长稿。
- 路由：撰写步用 `routeChapter`；自检/润色用 `routeCheck`（与现设置语义一致）。

## UI

- Studio / 工具栏状态行展示阶段文案，例如：`③场次 2/5（1200/2500）→ ④补字 → ⑤细纲自检 → …`
- Agent 生成正文时显示相同阶段进度。
- 终检报告面板：字数条（目标 vs 实写）、自检 Markdown 摘要、再补一轮按钮。
- 取消按钮贯穿全程（复用现有 AbortSignal）。

## 入口映射

| 入口 | 行为 |
|---|---|
| `ChapterTools` 写本章 | `runWritePipeline`，`targetWords` 来自工具栏 |
| `runBatchWrite` | 每章 `runWritePipeline`；日志含字数与自检一行摘要 |
| `QuickStartPage` | 同上，默认字数可用 `defaultChapterWords` |
| `StatusPage` 重试 | 传入保存的目标字数或 `defaultChapterWords`（不再静默丢字数） |
| `generateFromChat` chapter | 同一 pipeline；字数优先级：对话中最近一次「约/目标 N 字」类表述（正则解析）> 工具栏当前值 > `defaultChapterWords` |

## 错误处理

- 单步 LLM 失败：`withRetry` 最多 2 次；仍失败 → `phase=error`，保留已有正文 + 可读错误。
- 用户 Abort：停止后续步骤，保留编辑器内容，报告「已取消」。
- 规划/简报失败：可降级为「按细纲原文场次均分字数」继续写，避免整章不可用。

## 测试

- 单元：字数比例判断、续写轮次上限、计划解析（场次列表）、`maxTokens` 估算。
- 手动：目标 2500 写一章，实写应落在约 2250～2875；状态行阶段可见；取消后正文仍在。

## 不做（本规格）

- 云同步、多人协作
- 自由 tool-calling 多 Agent
- 多模型投票选稿
- 「快速一稿」省步骤预设（后续可选）

## 后续（可选，不阻塞首版）

- 章型模板：爽点章 / 过渡章 / 高潮章（影响简报与字数分配）
- 人物卡「本章必出场」高亮；自检不过标红
- 章末一键下一章（强化钩子承接）

## 验收标准

1. 同一书、目标 2500，连续写 3 章（或同章重写 3 次），至少 2 次实写字数 ∈ [2250, 2875]。
2. 人为删掉细纲一场要点后重跑，终检报告能指出缺失或自动补入。
3. 工具栏与 Agent 落稿均出现多阶段进度，而非一次黑盒生成。
4. 关闭 `writePipelineEnabled` 可回退旧单次生成（兼容）。
