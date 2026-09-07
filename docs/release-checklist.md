# 发版检查清单

目标版本以 `package.json` 的 `version` 为准。

## 1. 版本三处对齐

- [ ] `package.json` → `version`（如 `0.5.0`）
- [ ] `electron/updater.cjs` → `APP_VERSION_CODE`（`0.5.0` → `5`；与管理端上传的 versionCode 一致）
- [ ] `APP_VERSION_NAME` 使用 `app.getVersion()`，勿手写；启动后看 `userData/logs/version.log` 无 WARN

## 2. 本地验证

- [ ] `npm test`
- [ ] `npx tsc -b --pretty false`
- [ ] 桌面端走一遍 [e2e-smoke.md](./e2e-smoke.md)

## 3. 打包与上传

- [ ] `npm run pack:win`（或 mac/linux）
- [ ] 管理端上传安装包与清单（appKey=`dashuai-moshu`），填写 versionName / versionCode / SHA256
- [ ] 用旧版客户端探测更新一次

## 4. 文档

- [ ] 更新 `CHANGELOG.md`
- [ ] README 授权 / 更新说明与代码一致
- [ ] 未签名分发时确认 `docs/signing-notes.md` 用户须知仍适用
