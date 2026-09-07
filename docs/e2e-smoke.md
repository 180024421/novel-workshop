# Wave 7 手测清单（e2e-smoke）

版本目标：`0.4.0`。在桌面端 `npm run dev:app` 打开一本测试书后逐项勾选。

## Wave 7 新能力

- [ ] ChapterTools「工艺润色」：扫描命中后可润色；会先备份再替换正文
- [ ] 写章流水线进行中点「本场后停」：当前场次写完后停，保留已写
- [ ] 写章前费用确认条（非 `window.confirm`）：确认写 / 取消
- [ ] 「上下文预览」勾选块 → 写入本章备注 `【上下文预览注入】`，写章可注入
- [ ] `/app/summaries` 可编辑并保存 `continuity/summaries.json`
- [ ] `/app/voice-check`：勾选近章 → 声口体检报告
- [ ] 扩展包页「一键补工艺红线」合并 style/taboo
- [ ] 侧栏工具分组：写作 / 设定 / 质检 / 导出
- [ ] 开书清单未完成时显示进度条（如 2/4）
- [ ] 书内搜索跳章后选中关键词（CodeMirror / textarea 均可）
- [ ] 主进程异常写入 `userData/logs/crash.log`（可人为触发验证）

## 写章与知识库（回归）

- [ ] 关闭 Embedding：写章仍能召回范文；优先注入 `chapter:` 源切片
- [ ] 开启 Embedding + 有效渠道 Key：写章可完成；失败时不阻断，回退 MiniSearch
- [ ] 保存正文且「自动索引本章」开启：`kb/index.json` 出现 `chapter:{id}` 切片

## Diff / 编辑器（回归）

- [ ] ChapterTools 对比备份：短文块级 Diff；勾选采纳可用
- [ ] 左右合计超长（>80000 字）出现「过长已整章对比」提示
- [ ] CodeMirror / textarea 切换后可保存

## Wave 6 能力抽检

- [ ] 近章摘要注入；实体卡；Stats；改稿队列；双稿 A/B；细纲对齐；导出排版

## 回归冒烟

- [ ] 设定 → 总纲 → 细纲 → 正文主路径可走通
- [ ] quality / fast 预设均可落稿
- [ ] 批量写断点续跑不炸
- [ ] 无细纲拒写章

## 纯函数冒烟

```bash
npm test
```

覆盖 craftFix / craftUpgrade / voiceCheck / writeContextPreview 等 Wave 7 helpers。
