# Changelog

## 0.5.0

- 修复更新通道版本号错配（`app.getVersion()` + versionCode 对齐）
- 大书性能：`fs:list` 带 mtime/size；`loadProjectProgress` 签名缓存；批量写跳过已有时只 listDir 一次
- 章文件名解析统一到 `chapterFiles.parseChapterFileName` / `buildChapterIndex`
- 应用内确认条（ConfirmHost）替代原生 `confirm` / `prompt`
- 过审检查：本地规则包 `compliance-cn` + `/app/compliance` + 健康分第 5 维
- 文风学习：导入向导 / 扩展包「学我的文风」
- 跨章一致性检查：健康分页单次 LLM 诊断
- 连载排期：存稿 / 断更风险（统计页 + 设置 + 侧栏角标）

## 0.4.0

- Wave 7：工艺润色 Diff 强制、声口一键改对白、本书健康分、上下文 `contextBlocks`
- 崩溃日志查看、修订备份清理、本地周报
- 导入己书：预览可编辑、结构落地、批量工艺润色

## 0.3.x

- Wave 6：摘要注入、实体卡、改稿队列、双稿 A/B、细纲对齐

## 0.2.x / 0.1.x

- Studio 四步、写章流水线、扩展包、授权试用与远程更新初版
