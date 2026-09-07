# 大帅墨枢 Wave 6 设计（补齐 + 新能力）

> **已确认（2026-09-07）**：按产品建议「全部实现」。仍不做云同步 / 多人协作 / 在线扩展市场 / 多模型投票。  
> **状态**：已实现。

## 目标

在 0.2.0 之上补齐已知缺口，并交付长连载护城河能力。

## A. 已知缺口补齐

1. 写章 `retrieveChunks` 传入卷/章相关 `sourcePrefix`（优先 `chapter:` 与设定源）
2. Embedding 可选：兼容 OpenAI `/embeddings`；失败回退 MiniSearch
3. Diff / CM6 选区与超长章兜底提示
4. 导出边角：空章跳过、非法文件名清理（代码层）

## B. 新功能

| ID | 能力 | 要点 |
| --- | --- | --- |
| B1 | 章摘要账本 | 写章成功后抽 100–200 字摘要 → `continuity/summaries.json`；写后续章注入近 N 章摘要 |
| B2 | 实体卡 | `entities/*.json`（地点/势力/器物/术语）；写章召回命中名；EntitiesPage |
| B3 | 节奏仪表盘 | Stats 增强：钩子开闭比、章均字数分布、战斗/日常粗标签占比 |
| B4 | 改稿任务队列 | 全书扫禁忌 / 抽钩子补全；复用 batchSession 模式 |
| B5 | 双稿 A/B | `chapters/…` 主稿 + `drafts/{chapterId}-B.md`；切换与升主 |
| B6 | 细纲↔正文对齐 | 正文页抽屉：场次列表 + 正文是否覆盖关键词 |
| B7 | 平台排版 | 导出前 qidian/tomato 空行与章末字数条 |
| B8 | 本地模型 | providerPresets 增加 Ollama / LM Studio |

## C. 体验

- 首页/空书 checklist（设定→总纲→细纲→第1章）
- 写本章前费用确认条（可关）
- 流水线失败展示 phase + 短因
- 书内搜索按卷分组 + 跳转高亮 query

## D. 工程

- vitest 覆盖新纯函数
- `docs/signing-notes.md` 已有则不重复；可选 `docs/e2e-smoke.md` 手测清单
- 版本 bump `0.3.0`

## 约束

- 本地文件夹模型；新字段可选
- 无细纲仍拒写章
- Embedding / 费用确认默认：embedding 关；确认条开
