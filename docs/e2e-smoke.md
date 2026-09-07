# Wave 6 手测清单（e2e-smoke）

版本目标：`0.3.0`。在桌面端 `npm run dev:app` 打开一本测试书后逐项勾选。

## 写章与知识库

- [ ] 关闭 Embedding：写章仍能召回范文；优先注入 `chapter:` 源切片
- [ ] 开启 Embedding + 有效渠道 Key：写章可完成；失败时不阻断，回退 MiniSearch
- [ ] 开启 Embedding 但无 Key：提示回退；写章正常
- [ ] 保存正文且「自动索引本章」开启：`kb/index.json` 出现 `chapter:{id}` 切片
- [ ] Embedding 成功后可选出现 `kb/vectors.json`（按 chunk id）

## Diff / 编辑器

- [ ] ChapterTools 对比备份：短文块级 Diff；勾选采纳可用
- [ ] 左右合计超长（>80000 字）出现「过长已整章对比」提示，且为整章 replace
- [ ] CodeMirror / textarea 切换后可保存

## Wave 6 新能力抽检

- [ ] 写章成功后近章摘要可注入（`continuity/summaries.json`）
- [ ] 实体卡命中名可进提示词；Entities 页可增删
- [ ] Stats：钩子 / 字数桶 / 粗标签有数
- [ ] 改稿队列可扫禁忌或补钩子（可取消）
- [ ] 双稿 B 可切换 / 升主
- [ ] 细纲对齐抽屉：场次覆盖标记合理
- [ ] 导出 qidian/tomato 排版与空章跳过
- [ ] 设置可见 Ollama / LM Studio 预设

## 回归冒烟

- [ ] 设定 → 总纲 → 细纲 → 正文主路径可走通
- [ ] quality / fast 预设均可落稿
- [ ] 批量写断点续跑不炸
- [ ] 无细纲拒写章
