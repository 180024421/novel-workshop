# 大帅墨枢功能波次设计（横切增强）

> **已确认（2026-09-07）**：采用横切增强路线；除「不做」清单外全部落地。  
> **前置已交付**：UX 大改、质量优先写作流水线（见同目录 `2026-09-06-*`）。  
> **状态（2026-09-07）：已实现** — Wave 1–5 已合入 `main`（版本 `0.2.0`）；`npm test` 63 通过。已知缺口：Embedding 无真实向量 API（回退 MiniSearch）；写章检索未强制 `sourcePrefix`。

## 1. 目标

在保持本地文件夹书稿模型的前提下，补齐：

1. **改稿信任**（Diff / 采纳 / 还原）
2. **成本可控**（快慢预设、流水线可跳过、批量断点）
3. **迁移与导出**（导入 TXT/MD、EPUB/DOCX、本地扩展包 zip）
4. **连贯与洞察**（伏笔看板、卷级体检、写作统计）
5. **工程可维护**（Studio 拆分、CodeMirror、设置 Tab、知识库增强、单测）

## 2. 约束

| 类型 | 规则 |
| --- | --- |
| 产品边界 | **不做**云同步、多人协作、在线扩展市场 |
| 发版 | **不做**真实代码签名/公证（无证书）；仅补 `docs` 说明与脚本占位 |
| 数据模型 | 继续以项目根目录文件为准（`chapters/`、`revisions/`、`continuity/` 等） |
| 架构 | 新逻辑优先纯函数进 `src/lib/*`；UI 薄封装；Electron 只补文件/zip 桥 |
| 主流程 | Studio 四步（设定 / 总纲 / 细纲 / 正文）不变；工具页挂侧栏 |
| 兼容 | 旧书稿目录结构可读；新字段均可选，缺省走现有行为 |

## 3. 架构原则

```
┌──────────── UI（pages / components）────────────┐
│  Studio* / DiffDrawer / ImportWizard / Stats … │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  lib：diff / importManuscript / export* /       │
│  writePipeline* / hooks* / volumeCheck / kb* …  │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  Electron preload/main：读写、zip、选文件、导出 │
└─────────────────────────────────────────────────┘
```

- **横切增强**：不先重写内核再加功能；Wave 内夹带必要拆分。
- **行为一致**：写本章 / 批量 / Agent 落稿仍共用 `runWritePipeline`（或 fast 短路）。
- **可测**：diff 算法、导入拆章、导出走纯函数 + vitest；UI 冒烟靠手动验收清单。

## 4. Wave 总览

| Wave | 主题 | 交付物 | 验收焦点 |
| --- | --- | --- | --- |
| 1 | 改稿信任 | Diff UI、扫描修正 | 生成后能对比备份并局部采纳 |
| 2 | 成本与批量 | 快慢预设、跳过/重试、断点面板 | 批量可续跑；fast 显著少步 |
| 3 | 迁移导出 | 导入向导、EPUB/DOCX、pack zip | 外来 TXT 可建书；可导出成书格式 |
| 4 | 看板洞察 | 伏笔、卷检、统计页 | 钩子可跳转；卷检有报告 |
| 5 | 工程编辑器 | Studio 拆分、CM6、KB、设置 Tab、测试 | Studio 行数下降；长文可编辑 |

各 Wave **独立可运行**；合并顺序建议 1→5。允许 Wave 5 的 Studio 拆分与 Wave 1 Diff 并行设计，但 Diff 入口先挂 `ChapterTools`，拆分后再挪模块边界。

---

## 5. Wave 1 — 改稿信任

### 5.1 章节 Diff

**入口**

- `ChapterTools`：「对比备份」列表（现有 `listBackups`）→ 打开 Diff 抽屉
- 写前自动备份（现有 `backupChapter`）不变；生成成功后可「与写前对比」快捷入口

**对比源**

- Left：选中的 `revisions/*.md`（或写前快照）
- Right：当前编辑器正文（未保存也以编辑器为准）

**算法（纯函数）**

- 新建 `src/lib/textDiff.ts`
- 按**段落**（空行分段）做 LCS / Myers 简化版，输出：
  ```ts
  type DiffChunk = {
    type: "equal" | "add" | "del" | "replace";
    left?: string;
    right?: string;
  };
  ```
- 不引入重量级 diff 依赖；长文超阈值（如 >8 万字）时降级为「整章二选一」，并提示

**UI**

- 新建 `src/components/ChapterDiffDrawer.tsx`
- 模式：并排 / 统一（unified）切换
- 操作：
  - **采纳右侧块**：把某 `add`/`replace` 的 right 写入编辑器对应位置（按块索引应用）
  - **整章用备份覆盖**：确认后 `restoreBackup` → `setDoc`
  - **整章保留当前**：关闭
- 应用块后不自动关抽屉；提供「全部采纳右侧变更」需二次确认

**落盘**

- 采纳后不强制保存；沿用现有 Ctrl+S / 自动保存策略

### 5.2 人名扫描修正

**现状问题**：`scanNamePresence` 对人物卡全名「本章未出现」一律告警，配角误报多。

**规则（改）**

1. 从**本章细纲**文本提取可能出场名（与人物卡 `name` 做包含/相等匹配）→ `expectedNames`
2. 仅对 `expectedNames` 检查正文是否出现
3. 另增：细纲出现的卡内人名若正文用了**近似别名**（可选简单：卡上 name 的 2 字后缀出现但全名未出现）→「疑似用了简称」弱提示，不阻断

**文件**：`src/lib/scan.ts` + 单测。

---

## 6. Wave 2 — 成本与批量

### 6.1 写作预设

**设置字段**

```ts
// AppSettings
writePreset?: "quality" | "fast"; // 默认 quality
```

| 预设 | 行为 |
| --- | --- |
| `quality` | 现七步流水线（受各 `writePipeline*` 开关约束） |
| `fast` | 等价：`writePipelineEnabled` 语义上短路为单次 `chapterPrompt` 落稿；忽略 wordgate / beats_check / polish（即使开关开着） |

**UI**

- 设置页「写作」区：预设单选 + 说明
- `ChapterTools` / 批量页顶栏可临时覆盖本次任务预设（不写回设置，除非点「设为默认」）

**实现点**

- `chapterWrite.ts` / `runWritePipeline`：入口读 `effectivePreset`；`fast` 走现有非 pipeline 分支或 pipeline 内 early return 单次 scene

### 6.2 流水线可控

**设置 / 运行时选项**

```ts
writePipelineSkipBeatsCheck?: boolean; // 默认 false；也可仅运行时
writePipelineSkipPolish?: boolean;
```

- 运行中状态行提供「跳过本阶段」（仅对 `beats_check` / `polish` 有效；`scene`/`wordgate` 不可跳以免半章）
- 失败时：终检报告区「从失败阶段重试」——保留 `bodySoFar`，从 `beats_check` 或 `polish` 再跑（不重写 scene）

**进度类型扩展**（可选）

```ts
// WritePipelineProgress 增加
canSkip?: boolean;
retryPhase?: WritePipelinePhase;
```

### 6.3 批量断点续跑

**现状**：`jobQueue` + `BatchPage` 已有跳过已有、中断勾选。

**增强**

- 持久化批量会话：`jobs/batch-session.json`（或沿用 jobQueue 扩展字段）
  ```ts
  type BatchSession = {
    id: string;
    from: number;
    to: number;
    preset: "quality" | "fast";
    skipExisting: boolean;
    done: string[];      // chapterId
    failed: { chapterId: string; error: string }[];
    pending: string[];
    updatedAt: string;
  };
  ```
- `BatchPage` 面板：进度条、失败列表、「继续未完成」「只重试失败」「清空会话」
- 应用重启后可恢复未完成会话（打开 Bulk 页提示）

---

## 7. Wave 3 — 迁移与导出

### 7.1 导入 TXT/MD 建书

**入口**：首页 / QuickStart 旁「导入书稿」

**流程**

1. 选文件（`.txt` / `.md`）→ `readImportText`
2. 预览拆章结果（可调规则）
3. 填书名、题材、目标目录（默认文档/大帅墨枢）
4. `createProject` + 写入 `chapters/第N章_标题.md` + 可选生成空细纲占位

**拆章规则（纯函数 `src/lib/importManuscript.ts`）**

优先匹配行首：

- `第\d+章` / `Chapter\s+\d+` / `# 第\d+章` / `### 第\d+章`
- 连续分隔线 `---` 且前后有标题行时次优先
- 若无法识别：整篇一章「第1章_导入」；UI 提示手动拆

**边界**

- 单文件过大（>20MB）拒绝并提示拆分
- 不自动生成总纲/人物（可勾选「导入后打开 Studio」）

### 7.2 导出 EPUB / DOCX

**扩展** `ExportFormat`：`"epub" | "docx"`（保留原 markdown/qidian/feilu/plain）

| 格式 | 实现策略 |
| --- | --- |
| EPUB | 主进程用轻量组装（zip + 必要 XML/XHTML）；依赖已有 `jszip`；封面可选缺省 |
| DOCX | 主进程或渲染进程用最小 OOXML（`document.xml` + zip）；或引入单一专用库（若体积可接受，优先 `docx` npm，打进 Electron） |

**入口**：`StatusPage` / 侧栏导出菜单增加选项；`exportBook` 分支或 `exportBookRich.ts`

**验收**：用系统阅读器 / Word 能打开；章序与标题正确。

### 7.3 本地扩展包 zip 导入

**不做在线商店**；做：

- `PacksPage`：「导入 zip」→ 解压到用户 packs 目录或项目 `packs/`
- 校验 `pack.json`（`id`/`name`/`files`）
- 与现有内置 `packs/*` 并列列出；冲突同 id 时确认覆盖

**Electron**：`importPackZip(path)` → 解压 + 返回 pack 元数据。

---

## 8. Wave 4 — 看板与一致性

### 8.1 伏笔看板增强

**数据扩展** `HookItem`：

```ts
dueChapter?: string;   // 期望回收章号，可空
note?: string;
```

**UI（Timeline 或独立 Hooks 区）**

- 筛选：open / resolved / 已过期（当前章号 > due 且仍 open）
- 操作：设到期、标记回收、**跳转正文**（`setChapterId` + navigate `/app/chapter`）
- 写章 prompt 侧：继续注入 open hooks；若有 due=本章，加粗「本章必收」

### 8.2 卷级一致性检查

**入口**：`VolumesPage` 或 Status「卷体检」

**流程（LLM + 规则）**

1. 汇总：本卷细纲、人物卡摘要、开放钩子、本卷已写章标题列表
2. `routeCheck` 一次结构化报告（Markdown）：
   - 人物弧缺口
   - 时间线疑点
   - 势力/地图前后矛盾
   - 未回收钩子
3. 报告落盘 `continuity/volume-check-{volumeId}.md`，可再跑

**非目标**：不自动改正文。

### 8.3 写作统计看板

**新建** `src/pages/StatsPage.tsx`，路由 `/app/stats`，侧栏工具链增加「写作统计」。

**数据源**

- `usageLedger`（日字数 / 成本）
- `projectProgress`（章完成）
- 本地计算：连续写作天数、近 7/30 日曲线（简单条形，CSS 即可）、章均字数

**不引入**图表重库。

---

## 9. Wave 5 — 工程与编辑器

### 9.1 Studio 拆分

目标：`StudioPage.tsx` 从 ~1900 行降到编排壳 <400 行。

建议模块：

| 模块 | 职责 |
| --- | --- |
| `studio/StudioEditorPane.tsx` | 文档编辑、查找替换、预览分屏 |
| `studio/StudioAgentPanel.tsx` | 右侧对话与生成入口 |
| `studio/StudioBeatsDrawer.tsx` | 细纲预览抽屉 |
| `studio/useStudioDocument.ts` | 加载/保存/切章 |
| `studio/useStudioGenerate.ts` | 调用 pipeline / agent |

**行为零变更**为验收标准（热键、保存、四步 mode 切换）。

### 9.2 CodeMirror 6

- 依赖：`@codemirror/view` / `state` / `lang-markdown`（或纯 plain text + markdown 高亮可选）
- 封装 `components/StudioCodeEditor.tsx`，props 对齐现 textarea（value/onChange/ref 能力用 `EditorView`）
- 保留外观 CSS 变量（字号、行距、主题色）
- 查找替换可迁到 CM 扩展或保留外置条
- 失败回退：feature flag `editorEngine: "textarea" | "codemirror"` 默认 cm

### 9.3 知识库增强

| 能力 | 说明 |
| --- | --- |
| 章文自动索引 | 保存正文后可选写入 KB chunks（source=`chapter:第N章`）；设置开关默认开 |
| 按卷过滤 | `retrieveChunks` 增加 `sourcePrefix` / volume 过滤 |
| Embedding | **默认关**；开则用当前 LLM embedding API（若 provider 支持），向量存项目 `kb/vectors.json`；不支持则回退 MiniSearch 并提示 |

不引入云端向量库。

### 9.4 设置页 Tab 化

Tabs：`模型与路由` | `写作流水线` | `外观与热键` | `备份与更新` | `授权中心`

折叠逻辑可保留在 Tab 内；URL hash 记忆当前 Tab。

### 9.5 测试补齐

最少新增：

- `textDiff.test.ts`
- `importManuscript.test.ts`
- `scan.test.ts`（人名规则）
- `writePipeline` fast/skip 分支的 utils 级测
- `export` 纯组装测（不启 Electron 的 XML/zip fixture）

---

## 10. 设置与类型增量汇总

```ts
// AppSettings 新增（均为可选）
writePreset?: "quality" | "fast";
writePipelineSkipBeatsCheck?: boolean;
writePipelineSkipPolish?: boolean;
editorEngine?: "textarea" | "codemirror";
kbAutoIndexChapters?: boolean; // default true
kbEmbeddingEnabled?: boolean;  // default false
```

```ts
// HookItem 新增
dueChapter?: string;
note?: string;
```

```ts
// ExportFormat 扩展
type ExportFormat = "markdown" | "qidian" | "feilu" | "plain" | "epub" | "docx";
```

## 11. Electron 桥增量

| API | 用途 |
| --- | --- |
| `importPackZip` | 扩展包 zip |
| `exportEpub` / `exportDocx`（或统一 `exportRich`） | 富格式导出 |
| 已有 `readImportText` | 导入向导复用 |

## 12. 明确不做

- 云同步、账号体系、多人实时协作
- 在线扩展市场 / 远程下载 pack 目录
- 多模型投票选稿
- 真实 Apple/Windows 代码签名与公证（仅文档：`docs/signing-notes.md` 占位说明所需证书与命令）
- 改变「无细纲拒写章」产品规则

## 13. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Studio 拆分回归 | Wave 5 先测后拆；保留行为对照清单 |
| CM6 与现热键冲突 | 热键仍由 React 层监听；CM 内禁用冲突绑定 |
| EPUB/DOCX 兼容性 | 最小合法包 + 真机打开验收；失败回退 TXT |
| 批量会话损坏 | 读写 JSON try/catch；坏文件丢弃并提示 |
| Embedding 无端点 | 开关可见但禁用并文案说明 |

## 14. 验收总清单（产品）

- [x] 写章后能与写前备份 Diff，并能块级采纳或整章还原
- [x] 配角未出场不再误报；细纲出场人名未写才告警
- [x] 预设 fast/quality 可切换；批量可断点续跑与重试失败
- [x] 可跳过 polish/beats；失败可从该阶段重试
- [x] TXT/MD 导入可建书并进 Studio
- [x] 可导出 EPUB、DOCX，可读
- [x] 本地 zip 扩展包可导入应用
- [x] 伏笔可设到期、筛选、跳转章节
- [x] 卷体检产出 Markdown 报告
- [x] 统计页展示字数/成本/连续天
- [x] Studio 拆分后主流程无回归；长章编辑可用 CM6
- [x] 设置 Tab 可找到原有全部配置
- [x] 新增纯函数单测通过（`npm test`）

## 15. 文档与版本

- 本规格：`docs/superpowers/specs/2026-09-07-feature-wave-design.md`
- 实施计划：`docs/superpowers/plans/2026-09-07-feature-waves.md`
- 签名占位：`docs/signing-notes.md`
- 版本：`0.2.0`
