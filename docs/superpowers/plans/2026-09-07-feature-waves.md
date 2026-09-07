# Feature Waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-09-07-feature-wave-design.md` 落地 Wave 1–5（Diff、快慢预设、导入导出、看板统计、Studio/CM6/KB），不做云同步/多人协作/在线扩展市场/真实签名。

**Architecture:** 横切增强；纯函数进 `src/lib/*`，UI 薄封装，Electron 只补文件/zip 桥；写章入口仍走 `writeOneChapter` / `runWritePipeline`。

**Tech Stack:** React 19 + Vite + Electron + TypeScript + vitest；EPUB/DOCX 用 jszip（+ 最小 OOXML）；编辑器用 CodeMirror 6。

## Global Constraints

- 本地文件夹书稿；无云同步 / 无多人协作 / 无在线扩展市场
- 无细纲仍拒绝写章
- 新设置字段均可选，缺省 = 现有行为
- 不引入真实代码签名（仅 `docs/signing-notes.md`）
- 工作目录仅 `E:/xiangmu/novel-workshop`

## File Map

| Path | Responsibility |
| --- | --- |
| `src/lib/textDiff.ts` | 段落级 diff |
| `src/lib/importManuscript.ts` | TXT/MD 拆章 |
| `src/lib/batchSession.ts` | 批量断点会话 |
| `src/lib/volumeCheck.ts` | 卷级体检 prompt + 落盘 |
| `src/lib/exportRich.ts` | EPUB/DOCX 组装入口 |
| `src/lib/scan.ts` | 人名扫描修正 |
| `src/lib/writePipeline.ts` / `chapterWrite.ts` | fast / skip / retry |
| `src/lib/hooksLedger.ts` | dueChapter / note |
| `src/lib/kb.ts` | 章索引 / 卷过滤 |
| `src/components/ChapterDiffDrawer.tsx` | Diff UI |
| `src/pages/ImportPage.tsx` | 导入向导 |
| `src/pages/StatsPage.tsx` | 写作统计 |
| `src/pages/studio/*` | Studio 拆分 |
| `src/components/StudioCodeEditor.tsx` | CM6 封装 |
| `electron/main.cjs` + `preload.cjs` | zip pack / rich export |
| `src/types.ts` | AppSettings / HookItem / ExportFormat |

---

### Task 1: textDiff 纯函数 + 测试

**Files:**
- Create: `src/lib/textDiff.ts`
- Create: `src/lib/textDiff.test.ts`

**Produces:**
- `splitParagraphs(text: string): string[]`
- `diffParagraphs(left: string, right: string): DiffChunk[]`
- `applyChunks(left: string, right: string, chunks: DiffChunk[], acceptRightIndexes: number[]): string`
- `type DiffChunk = { type: "equal" | "add" | "del" | "replace"; left?: string; right?: string }`
- 常量 `DIFF_CHAR_SOFT_LIMIT = 80000`；超限返回单块 replace

- [ ] **Step 1:** 写失败测试（相等 / 增删改 / 超限降级）
- [ ] **Step 2:** `npx vitest run src/lib/textDiff.test.ts` 期望 FAIL
- [ ] **Step 3:** 实现 LCS 段落 diff + applyChunks
- [ ] **Step 4:** 测试 PASS
- [ ] **Step 5:** Commit `feat(diff): add paragraph textDiff helpers`

### Task 2: 人名扫描修正

**Files:**
- Modify: `src/lib/scan.ts`
- Create: `src/lib/scan.test.ts`
- Modify: `src/components/ChapterTools.tsx`（`runChapterScan` 传细纲推导名单）

**Produces:**
- `expectedNamesFromBeats(beats: string, cardNames: string[]): string[]`
- `scanNamePresence(body, expectedNames)` 仅查 expected
- `scanNameShortAlias(body, expectedNames): ScanHit[]`（全名未出现但 2 字后缀出现 → 弱提示，kind 仍「人名疑似漂移」）

- [ ] 测试 + 实现 + 接线 `runChapterScan`
- [ ] Commit `fix(scan): only warn for beats-expected character names`

### Task 3: ChapterDiffDrawer UI

**Files:**
- Create: `src/components/ChapterDiffDrawer.tsx`
- Modify: `src/components/ChapterTools.tsx`（备份列表打开抽屉；写后「与写前对比」）
- Modify: `src/styles.css`（diff 样式）

**Consumes:** `diffParagraphs`, `listBackups`, `restoreBackup`

- [ ] 并排/统一切换；块采纳；整章还原（confirm）
- [ ] Commit `feat(diff): chapter backup diff drawer`

### Task 4: writePreset fast/quality

**Files:**
- Modify: `src/types.ts`（`writePreset?: "quality" | "fast"`）
- Modify: `src/state/AppContext.tsx` 默认值
- Modify: `src/lib/chapterWrite.ts`（fast → 非 pipeline 分支）
- Modify: `src/pages/SettingsPage.tsx`、`ChapterTools.tsx`、`BatchPage.tsx` 临时覆盖

- [ ] Commit `feat(write): quality/fast write presets`

### Task 5: 流水线 skip / 单步重试

**Files:**
- Modify: `src/types.ts`（skip flags）
- Modify: `src/lib/writePipeline.ts`（跳过 beats_check/polish；`resumeFrom` 可选）
- Modify: `ChapterTools` / Studio 进度条「跳过本阶段」「从失败重试」

**Produces:** `runWritePipeline(opts & { resumeFrom?: WritePipelinePhase; resumeBody?: string; skipBeatsCheck?: boolean; skipPolish?: boolean })`

- [ ] Commit `feat(pipeline): skip polish/beats and resume from phase`

### Task 6: 批量断点会话

**Files:**
- Create: `src/lib/batchSession.ts`
- Modify: `src/lib/chapterWrite.ts`（`runBatchWrite` 更新 session）
- Modify: `src/pages/BatchPage.tsx`

**Produces:** `load/save/clearBatchSession`，路径 `continuity/batch-session.json`

- [ ] Commit `feat(batch): resumable batch write session`

### Task 7: 导入书稿向导

**Files:**
- Create: `src/lib/importManuscript.ts` + `.test.ts`
- Create: `src/pages/ImportPage.tsx`
- Modify: `src/App.tsx`、`HomePage.tsx` 入口

**Produces:** `splitManuscript(text): { id, title, body }[]`

- [ ] Commit `feat(import): TXT/MD manuscript import wizard`

### Task 8: EPUB / DOCX 导出

**Files:**
- Create: `src/lib/exportRich.ts`（或 electron 侧组装）
- Modify: `src/lib/exportBook.ts`（format 扩展）
- Modify: `electron/main.cjs`、`preload.cjs`、`types.ts`
- Modify: `StatusPage.tsx`

- [ ] Commit `feat(export): EPUB and DOCX export`

### Task 9: 本地扩展包 zip

**Files:**
- Modify: `electron/main.cjs`、`preload.cjs`、`types.ts`（`importPackZip`）
- Modify: `src/pages/PacksPage.tsx`、`src/lib/packs.ts`

- [ ] Commit `feat(packs): import local pack zip`

### Task 10: 伏笔看板增强

**Files:**
- Modify: `src/lib/hooksLedger.ts`（`dueChapter`/`note`）
- Modify: `src/pages/TimelinePage.tsx`（筛选、跳转、设到期）
- Modify: prompt 注入「本章必收」

- [ ] Commit `feat(hooks): due chapter and jump-to-body`

### Task 11: 卷级体检 + 统计页

**Files:**
- Create: `src/lib/volumeCheck.ts`
- Modify: `VolumesPage.tsx` 或 Status
- Create: `src/pages/StatsPage.tsx`
- Modify: `App.tsx`、`AppLayout.tsx` 路由与侧栏

- [ ] Commit `feat(insights): volume check and writing stats page`

### Task 12: 设置 Tab + signing 文档

**Files:**
- Modify: `src/pages/SettingsPage.tsx`（Tabs + hash）
- Create: `docs/signing-notes.md`

- [ ] Commit `refactor(settings): tabbed settings; add signing notes`

### Task 13: 知识库增强

**Files:**
- Modify: `src/lib/kb.ts`、`types.ts`、Settings、保存正文钩子（Studio/auto-save）

- [x] `kbAutoIndexChapters` 默认 true；`retrieveChunks` 支持 source 过滤
- [x] `kbEmbeddingEnabled` 默认 false；无 embedding 端点则提示回退
- [x] Commit `feat(kb): chapter auto-index and volume filter`

### Task 14: Studio 拆分

**Files:**
- Create: `src/pages/studio/StudioEditorPane.tsx`、`StudioAgentPanel.tsx`、`StudioBeatsDrawer.tsx`、`useStudioDocument.ts`、`useStudioGenerate.ts`
- Modify: `src/pages/StudioPage.tsx` 变薄壳

- [x] 行为对照：Ctrl+S、四步 mode、生成、Agent
- [x] Commit `refactor(studio): split StudioPage into modules`

### Task 15: CodeMirror 6 编辑器

**Files:**
- `npm i @codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/commands`
- Create: `src/components/StudioCodeEditor.tsx`
- Modify: Studio 编辑区 + `editorEngine` 设置

- [x] Commit `feat(editor): CodeMirror 6 engine with textarea fallback`

### Task 16: 版本与 README

**Files:**
- Modify: `package.json` → `0.2.0`
- Modify: `README.md` 补充新功能条目
- Modify: spec 状态为已实现（全部勾选后）

- [x] `npm test` 全绿
- [x] Commit `chore: bump 0.2.0 and refresh README`

---

## Execution Notes

- 按 Task 1→16 顺序；每 Task 可独立提交。
- UI 手测清单见规格 §14。
- 若某 Task 受阻，跳过记入 PR 说明，不阻塞后续无关 Task。
