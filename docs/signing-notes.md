# 代码签名与公证说明（占位）

> 当前发版**不做**真实 Windows / macOS 代码签名与 Apple 公证（无证书）。本文仅记录日后接入所需材料与命令占位，避免发版时再摸索。

## Windows（Authenticode）

**需要**

- 代码签名证书（`.pfx` / EV 证书）及密码
- 签名工具：`signtool.exe`（Windows SDK）或 electron-builder 内置签名

**环境变量占位（勿提交真实值）**

```text
CSC_LINK=path/or/base64-of-pfx
CSC_KEY_PASSWORD=********
```

**命令占位**

```bash
# electron-builder 示例（证书就绪后取消注释/配置）
# npx electron-builder --win --publish never

# 或手动：
# signtool sign /f cert.pfx /p **** /tr http://timestamp.digicert.com /td sha256 /fd sha256 dist/*.exe
```

## macOS（Developer ID + 公证）

**需要**

- Apple Developer 账号
- Developer ID Application 证书
- App 专用密码 / API Key（`notarytool`）
- 公证用 Team ID

**环境变量占位**

```text
APPLE_ID=you@example.com
APPLE_APP_SPECIFIC_PASSWORD=****-****-****-****
APPLE_TEAM_ID=XXXXXXXXXX
CSC_LINK=path-to-p12
CSC_KEY_PASSWORD=********
```

**命令占位**

```bash
# electron-builder 示例
# npx electron-builder --mac --publish never

# 公证（打包产物就绪后）
# xcrun notarytool submit YourApp.dmg --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --wait
# xcrun stapler staple YourApp.dmg
```

## 当前策略

- 安装包可正常分发与覆盖安装；用户可能看到「未知发布者 / 无法验证开发者」提示，属预期。
- 证书到位后：在 CI / 本机注入上述变量，再跑 packaging 脚本即可，无需改业务代码。

## 相关

- 功能规格：`docs/superpowers/specs/2026-09-07-feature-wave-design.md` §明确不做
- packaging 目录下的安装/发布脚本（就绪后在此补充真实入口）
