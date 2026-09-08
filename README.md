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
- **导入改稿**：TXT/MD 可编辑拆章 → 结构落地（卷目录 + 工艺）→ 增卷增章 → 扫描/工艺润色/Diff；改稿队列支持批量工艺润色  
- **工艺润色 / 声口体检（含一键改对白）/ 章摘要看板 / 上下文预览（`contextBlocks`）/ 一键补工艺红线 / 本书健康分 / 过审检查 / 文风学习 / 跨章一致性 / 连载排期**：Wave 7+～0.5 体验与质检  
- **本地周报 / 崩溃日志查看导出 / 修订备份清理**：设置与统计页  
- **应用内确认条**：覆盖危险操作与新建章标题输入（替代系统弹窗）  
- **3 分钟演示**：首页演示脚本（样例 + 导入改稿）+ `docs/demo-3min.md`  
- **Studio 编辑器**：默认 CodeMirror 6（设置可回退 textarea）  
- **写作工艺红线**：禁止啰嗦/重复/电报文/顶真/标语口号等；要求人物丰满、画面感、张力、合理典故与修辞；扫描可启发式检出；旧书可在扩展包页一键合并红线  
- **本地模型预设**：Ollama / LM Studio 渠道模板  
- **定时本地备份**：设置里按小时自动 zip（仅本机）  
- **崩溃日志**：主进程异常写入 `userData/logs/crash.log`（软滚动）  
- **试用与授权**：首次启动起 **14 天试用**；设置 → 授权中心粘贴卡密 → 服务端兑换并验签 Ed25519 ticket（离线宽限约 72h）。开发/演示可用 `MOSHU-DEMO-FULL-ACCESS`（需 DEV 或 `VITE_ALLOW_DEMO_LICENSE=1`）。试用到期后软禁用「生成」按钮，不阻拦打开书稿。

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
3. 客户端通过 v1 加密信封提交设备指纹与卡密，校验返回的 Ed25519 ticket 后写入本地 `userData/license/`。
4. 可在授权中心 **解绑本机** 以腾出设备席位；**刷新状态** 可联网续签 ticket。

试用：自首次启动起 **14 天**。试用到期且无有效授权时，**仅软禁用生成**，仍可打开书稿。

#### 授权接口与传输

以 Electron 主进程实现为准，当前客户端先 `GET /api/crypto/public-key` 获取服务端 RSA 公钥，再对以下敏感接口发起 `POST`：

- `/api/app-license/dashuai-moshu/redeem`（scope：`app-license.redeem`）
- `/api/app-license/dashuai-moshu/status`（scope：`app-license.status`）
- `/api/app-license/dashuai-moshu/unbind`（scope：`app-license.unbind`）

请求使用 v1 **RSA-OAEP（SHA-256）+ AES-256-GCM** 加密信封，服务端响应也必须是可认证解密的加密数据。信封包含 `version`、`keyId`、`timestamp`、`requestId`、`scope`、`iv`、`encryptedKey`、`ciphertext`；卡密、设备指纹和 ticket 不再明文提交。

本项目没有调用远程 `usage-history` 接口；写作字数与费用历史仅保存在本机 `userData/usage.json`。因此这里不声明不存在的远程路径或参数。授权 `status` 已明确使用 `POST`，不能按旧版 `GET` 或明文请求接入。

旧客户端若仍使用明文授权协议，将无法与只接受 v1 加密信封的授权服务兼容，必须升级到包含该协议实现的新版后再激活、刷新或解绑。本仓源码版本为 `0.5.0`；实际安装版本以应用内更新提示和正式发布包为准。

配置：

- API 根地址：设置里的「更新源地址」（`updateApiBase`），默认与大帅阅读同一公网入口。
- 验票公钥：构建时 `VITE_APP_LICENSE_PUBLIC_KEY` / 主进程 `APP_LICENSE_TICKET_PUBLIC_KEY`（见 `.env.example`）。**切勿**把私钥打进客户端。

#### 授权地址与网络排障

- 默认 API 根地址为 `https://1ph1hf8043323.vicp.fun`；自定义「更新源地址」时只填写根地址，不要追加 `/api/app-license/...`。
- 激活、刷新或解绑失败时，先确认系统时间正确，并确认当前网络、代理、防火墙或 DNS 能以 HTTPS 访问根地址及 `GET /api/crypto/public-key`。公钥请求失败时，后续敏感请求不会发送。
- 若公钥能获取但授权仍失败，检查服务端是否支持上述 v1 信封、对应 scope 和加密响应；不要改用明文请求绕过。
- 临时断网时，客户端会验证本地 ticket；未过期则显示使用缓存授权。ticket 过期、验签失败或设备指纹变化时仍需恢复网络刷新。

### 更新

- 启动时可静默检查；设置页可手动检查 / 下载。
- 频道：**正式** `dashuai-moshu` / **测试** `dashuai-moshu-beta`。
- 下载完成后校验服务端 `desktopSha256` / `downloadSha256`；`forceUpdate` 时会阻止生成并提示必须更新。
- 升级时运行新安装包覆盖安装，不要删除书稿目录或 Electron `userData`。默认书稿在「文档/大帅墨枢」，自选项目仍在用户选择的目录；授权 ticket、设备 machine-id 与缓存位于 `userData/license/`。它们都与程序安装目录分离。
- Windows 安装包配置为卸载时不主动删除应用数据，但手工清理 `userData`、删除书稿目录或使用清理工具仍会造成数据/授权缓存丢失；升级前建议先做本地 zip 备份。

### 公告与维护

- 启动与设置页可拉取 `GET /api/app-meta/dashuai-moshu`；若 **404** 则降级为空公告。
- 非强制公告可「不再显示」；`force` / `critical` 会弹窗。
- `maintenance.enabled` 时禁用生成。



### Mac 构建说明

- package.json 已增加 Mac 脚本（dmg/zip，arm64 与 x64）。
- 必须在苹果电脑 macOS 上构建；不能从 Windows 交叉编译已签名 Mac 包。
- 当前未配置苹果开发者签名（identity 为空）；正式发版请在 Mac 上签名公证。
