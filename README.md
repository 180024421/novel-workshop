# 大帅墨枢（Dashuai Moshu）

通用 AI 小说写作桌面平台（本地许可，无云同步 / 无多人协作）。

## 主流程

1. 贴 API Key（设置 / 向导）  
2. **设定** → 世界观、卖点、人物草案（Studio 左栏第 1 步）  
3. **总纲** → 全书梗概、分卷主题（不要写第 N 章列表）  
4. **细纲（按卷）** → 本卷简介 + 章节目录 + 各章场次；可「章节目录」再补场次  
5. **正文** → 按细纲写本章；Agent 可连贯检查 / 人物声口对照  

写作区在 **Studio**（设定 / 总纲 / 细纲 / 正文 四页共用中间编辑器 + 右侧 Agent）。

## 常用工具

- **批量写**：按细纲批量生成正文；支持断点续跑  
- **时间线 / 伏笔看板**：可设到期章、筛选与跳转  
- **导入书稿**：TXT/MD 拆章建书  
- **导出**：TXT / EPUB / DOCX；侧栏「更多」或 Studio 顶栏快捷按钮  
- **章 Diff**：备份对比、块级采纳与整章还原（ChapterTools）  
- **写作预设**：quality（流水线）/ fast（单次落稿）；可跳过润色/细纲自检  
- **知识库**：范文切片检索；保存正文可自动索引本章（默认开）；可选 Embedding 向量重排（默认关，失败回退 MiniSearch）  
- **章摘要 / 实体卡 / 节奏统计 / 改稿队列 / 双稿 A/B / 细纲对齐 / 平台排版**：Wave 6 连载护城河能力  
- **Studio 编辑器**：默认 CodeMirror 6（设置可回退 textarea）  
- **本地模型预设**：Ollama / LM Studio 渠道模板  
- **定时本地备份**：设置里按小时自动 zip（仅本机）  
- **试用与授权**：首次启动起 **14 天试用**；设置中填写 `MOSHU-XXXX-XXXX-XXXX` 或演示码 `MOSHU-DEMO-FULL-ACCESS`。试用到期后软禁用「生成」按钮，不阻拦打开书稿。

```bash
npm install
npm run dev:app
```

默认目录：`文档/大帅墨枢/书名`。

## 打包

```bash
npm run pack:win
npm run pack:mac
npm run pack:linux
```

## 购买 / 激活 / 更新 / 公告

### 购买与激活

1. 通过设置页配置的**商城链接**或**闲鱼提示**购买卡密（客户端不内嵌支付密钥）。
2. 打开 **设置 → 授权中心**，粘贴卡密 → **兑换 / 激活**。
3. 客户端会提交设备指纹到 `POST /api/app-license/dashuai-moshu/redeem`，校验返回的 Ed25519 ticket 后写入本地 `userData/license/`。
4. 可在授权中心 **解绑本机** 以腾出设备席位；**刷新状态** 可联网续签 ticket。

试用：自首次启动起 **14 天**。试用到期且无有效授权时，**仅软禁用生成**，仍可打开书稿。

配置：

- API 根地址：设置里的「更新源地址」（`updateApiBase`），默认与大帅阅读同一公网入口。
- 验票公钥：构建时 `VITE_APP_LICENSE_PUBLIC_KEY` / 主进程 `APP_LICENSE_TICKET_PUBLIC_KEY`（见 `.env.example`）。**切勿**把私钥打进客户端。

### 更新

- 启动时可静默检查；设置页可手动检查 / 下载。
- 频道：**正式** `dashuai-moshu` / **测试** `dashuai-moshu-beta`。
- 下载完成后校验服务端 `desktopSha256` / `downloadSha256`；`forceUpdate` 时会阻止生成并提示必须更新。

### 公告与维护

- 启动与设置页可拉取 `GET /api/app-meta/dashuai-moshu`；若 **404** 则降级为空公告。
- 非强制公告可「不再显示」；`force` / `critical` 会弹窗。
- `maintenance.enabled` 时禁用生成。



### Mac 构建说明

- package.json 已增加 Mac 脚本（dmg/zip，arm64 与 x64）。
- 必须在苹果电脑 macOS 上构建；不能从 Windows 交叉编译已签名 Mac 包。
- 当前未配置苹果开发者签名（identity 为空）；正式发版请在 Mac 上签名公证。
