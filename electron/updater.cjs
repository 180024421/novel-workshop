/**
 * 大帅墨枢远程更新：对齐 desk-reader / jiaoben 通用 app-update 通道。
 * - 拉清单 → 可选下载 Setup → 用户手动覆盖安装
 * - 配置在 app.getPath('userData')，与安装目录分离，更新不丢
 * - 下载后校验 SHA256；尊重 forceUpdate；支持 stable|beta 频道
 */
const { app, dialog, shell, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { createWriteStream, createReadStream } = require("fs");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const crypto = require("crypto");

/**
 * versionName 从 package.json 读取（electron-builder 注入），勿手写。
 * versionCode 必须与管理端上传的 versionCode 一致；发版升版本时手动对齐（0.5.0 → 5）。
 */
function getAppVersionName() {
  try {
    return String(app.getVersion() || "0.5.0");
  } catch {
    return "0.5.0";
  }
}
/** 必须与管理端上传的 versionCode 一致（0.5.0 → 5） */
const APP_VERSION_CODE = 5;

function appendVersionLog(line) {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "version.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

/** 启动时：versionName 与 versionCode 相对 package.json 不一致则写 warn */
function warnIfVersionMismatch() {
  const name = getAppVersionName();
  const parts = parseVersionParts(name);
  // 0.x.y → 期望 code = x；1.2.3 → 期望 102
  const expected =
    parts[0] === 0 ? parts[1] || 0 : (parts[0] || 0) * 100 + (parts[1] || 0);
  if (APP_VERSION_CODE !== expected) {
    appendVersionLog(
      `WARN versionCode=${APP_VERSION_CODE} expected=${expected} from versionName=${name}`
    );
  } else {
    appendVersionLog(`OK versionName=${name} versionCode=${APP_VERSION_CODE}`);
  }
}

/** jiaoben 客户端更新通道 appKey */
const APP_UPDATE_KEY = "dashuai-moshu";
const APP_UPDATE_KEY_BETA = "dashuai-moshu-beta";

/** 默认更新源（与大帅阅读同一入口；管理端上传 appKey=dashuai-moshu） */
const PUBLIC_UPDATE_BASE = "https://1ph1hf8043323.vicp.fun";

let lastProbe = { hasUpdate: false, forceUpdate: false, remote: null, hint: "", ok: true, appKey: APP_UPDATE_KEY };
let downloadState = { state: "idle", label: "", filePath: "", error: "", percent: -1, shaOk: null };
let downloadAbort = null;

function parseVersionParts(v) {
  return String(v || "")
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => Number(n) || 0);
}

function compareVersionName(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function needUpdate(remote) {
  if (!remote) return false;
  if (remote.versionCode > APP_VERSION_CODE) return true;
  if (remote.versionName && compareVersionName(remote.versionName, getAppVersionName()) > 0) {
    return true;
  }
  return false;
}

function resolveUpdateAppKey(settings) {
  const ch = String((settings && settings.updateChannel) || "stable").toLowerCase();
  return ch === "beta" ? APP_UPDATE_KEY_BETA : APP_UPDATE_KEY;
}

function resolvePlatformDownloadUrl(info) {
  const win = String(info.desktopUrl || "").trim();
  const linuxArm = String(info.linuxArm64Url || "").trim();
  const linuxX64 = String(info.linuxX64Url || "").trim();
  const macArm = String(info.macArm64Url || "").trim();
  const macX64 = String(info.macX64Url || "").trim();
  const { platform, arch } = process;
  if (platform === "win32") return win;
  if (platform === "linux") {
    if (arch === "arm64") return linuxArm || linuxX64 || "";
    return linuxX64 || linuxArm || "";
  }
  if (platform === "darwin") {
    if (arch === "arm64") return macArm || macX64 || "";
    return macX64 || macArm || "";
  }
  return win;
}

function resolveExpectedSha256(data, downloadUrl) {
  const candidates = [
    data.downloadSha256,
    data.desktopSha256,
    data.sha256,
    data.fileSha256,
  ];
  if (process.platform === "linux") {
    if (process.arch === "arm64") candidates.unshift(data.linuxArm64Sha256);
    else candidates.unshift(data.linuxX64Sha256);
  }
  if (process.platform === "darwin") {
    if (process.arch === "arm64") candidates.unshift(data.macArm64Sha256);
    else candidates.unshift(data.macX64Sha256);
  }
  for (const c of candidates) {
    const s = String(c || "").trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(s)) return s;
  }
  void downloadUrl;
  return "";
}

function parseUpdatePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const data = raw;
  const versionCode = Number(data.versionCode || data.androidVersionCode || 0);
  const versionName = String(data.versionName || data.webVersion || "");
  const winUrl = String(data.desktopUrl || data.desktopSetupUrl || data.desktopPortableUrl || "");
  const linuxArm64Url = String(data.linuxArm64Url || "");
  const linuxX64Url = String(data.linuxX64Url || "");
  const macArm64Url = String(data.macArm64Url || "");
  const macX64Url = String(data.macX64Url || "");
  const downloadUrl = resolvePlatformDownloadUrl({
    desktopUrl: winUrl,
    linuxArm64Url,
    linuxX64Url,
    macArm64Url,
    macX64Url,
  });
  if (!versionCode && !versionName && !winUrl && !downloadUrl) return null;
  const forceUpdate = Boolean(data.forceUpdate || data.force || data.mandatory);
  const expectedSha256 = resolveExpectedSha256(data, downloadUrl || winUrl);
  return {
    versionCode,
    versionName,
    desktopUrl: downloadUrl || winUrl,
    downloadUrl: downloadUrl || winUrl,
    winUrl,
    linuxArm64Url,
    linuxX64Url,
    macArm64Url,
    macX64Url,
    changelog: String(data.changelog || ""),
    forceUpdate,
    expectedSha256,
  };
}

async function fetchUpdateFromUrl(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    const nested =
      json && typeof json === "object" && "data" in json ? json.data : json;
    return parseUpdatePayload(nested);
  } catch {
    return null;
  }
}

function scoreUpdate(info) {
  let s = (info.versionCode || 0) * 1000;
  if (info.downloadUrl || info.desktopUrl) s += 30;
  if (info.changelog && !String(info.changelog).includes("初始占位")) s += 5;
  return s;
}

function normalizeBase(u) {
  return String(u || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/https?:\/\/111\.229\.202\.251:8687/gi, PUBLIC_UPDATE_BASE)
    .replace(/https?:\/\/1ph1hf8043323\.vicp\.fun:8687/gi, PUBLIC_UPDATE_BASE);
}

async function fetchBestUpdate(apiBase, appKey) {
  const base = normalizeBase(apiBase) || PUBLIC_UPDATE_BASE;
  const key = appKey || APP_UPDATE_KEY;
  const urls = [
    `${base}/api/app-update/${key}`,
  ];
  // stable 时额外探测同名兜底（兼容旧清单）
  if (key === APP_UPDATE_KEY) {
    urls.push(`${base}/api/app-update/dashuai-moshu`);
  }
  const results = await Promise.all(urls.map((u) => fetchUpdateFromUrl(u)));
  let best = null;
  let bestScore = -1;
  for (const info of results) {
    if (!info) continue;
    const sc = scoreUpdate(info);
    if (sc > bestScore) {
      best = info;
      bestScore = sc;
    }
  }
  return best;
}

function platformLabel() {
  if (process.platform === "win32") return "Windows";
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "Linux/飞牛 ARM64" : "Linux x64";
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "macOS ARM" : "macOS Intel";
  }
  return process.platform;
}

function buildHint(remote, hasUpdate) {
  if (!remote) {
    return "暂无法连网检查 · 可稍后再试；配置与书稿在本地用户目录，更新不会丢";
  }
  const parts = [
    `当前 ${getAppVersionName()}（${APP_VERSION_CODE}）`,
    `远端 ${remote.versionName || "-"}（${remote.versionCode || 0}）`,
  ];
  if (hasUpdate) {
    parts.push(
      remote.downloadUrl
        ? `有新版本（${platformLabel()}），可下载安装包后覆盖安装`
        : `有新版本，但未配置 ${platformLabel()} 下载地址`
    );
    if (remote.forceUpdate) parts.push("此更新为强制更新");
  } else {
    parts.push("已是最新");
  }
  return parts.join(" · ");
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

async function probeUpdate(settings) {
  const apiBase = (settings && settings.updateApiBase) || PUBLIC_UPDATE_BASE;
  const appKey = resolveUpdateAppKey(settings || {});
  try {
    const remote = await fetchBestUpdate(apiBase, appKey);
    const hasUpdate = needUpdate(remote);
    const forceUpdate = Boolean(hasUpdate && remote && remote.forceUpdate);
    lastProbe = {
      hasUpdate,
      forceUpdate,
      remote,
      hint: buildHint(remote, hasUpdate),
      ok: Boolean(remote),
      appKey,
    };
  } catch (e) {
    lastProbe = {
      hasUpdate: false,
      forceUpdate: false,
      remote: null,
      hint: `检查失败：${e && e.message ? e.message.slice(0, 120) : e}`,
      ok: false,
      appKey,
    };
  }
  broadcast("app:updateProbe", lastProbe);
  return lastProbe;
}

function sanitizeFileName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
}

function deriveFileName(url, versionName) {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname || "");
    if (base && /\.(exe|dmg|AppImage|zip|tar\.gz)$/i.test(base)) {
      return sanitizeFileName(base);
    }
  } catch {
    /* ignore */
  }
  const ext =
    process.platform === "win32" ? ".exe" : process.platform === "darwin" ? ".dmg" : ".AppImage";
  return sanitizeFileName(`DashuaiMoshu-${versionName || "update"}${ext}`);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function downloadUpdate(settings) {
  if (downloadState.state === "downloading") return downloadState;
  let remote = lastProbe.remote;
  if (!remote || !lastProbe.hasUpdate) {
    await probeUpdate(settings || {});
    remote = lastProbe.remote;
  }
  const url = remote ? remote.downloadUrl || remote.desktopUrl : "";
  if (!remote || !url) {
    downloadState = {
      state: "error",
      label: "",
      filePath: "",
      error: remote
        ? `未配置 ${platformLabel()} 下载地址`
        : "暂无法获取新版本信息",
      percent: -1,
      shaOk: null,
    };
    broadcast("app:updateDownload", downloadState);
    return downloadState;
  }

  const dir = app.getPath("downloads");
  await fsp.mkdir(dir, { recursive: true });
  const fileName = deriveFileName(url, remote.versionName);
  let filePath = path.join(dir, fileName);
  if (fs.existsSync(filePath)) {
    const stem = fileName.replace(/\.[^.]+$/, "");
    const ext = path.extname(fileName);
    filePath = path.join(dir, `${stem}-${Date.now()}${ext}`);
  }

  downloadAbort = new AbortController();
  downloadState = {
    state: "downloading",
    label: "正在下载…",
    filePath,
    error: "",
    percent: 0,
    shaOk: null,
  };
  broadcast("app:updateDownload", downloadState);

  try {
    const res = await fetch(url, { signal: downloadAbort.signal });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    const nodeStream = Readable.fromWeb(res.body);
    let received = 0;
    nodeStream.on("data", (chunk) => {
      received += chunk.length;
      const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : -1;
      downloadState = {
        ...downloadState,
        label:
          total > 0
            ? `下载中 ${Math.round(received / 1024 / 1024)} / ${Math.round(total / 1024 / 1024)} MB（${percent}%）`
            : `下载中 ${Math.round(received / 1024 / 1024)} MB`,
        percent,
      };
      broadcast("app:updateDownload", downloadState);
    });
    await pipeline(nodeStream, createWriteStream(filePath));

    const expected = String(remote.expectedSha256 || "").toLowerCase();
    if (expected) {
      downloadState = {
        ...downloadState,
        label: "正在校验 SHA256…",
        percent: 100,
      };
      broadcast("app:updateDownload", downloadState);
      const actual = await sha256File(filePath);
      if (actual !== expected) {
        try {
          await fsp.unlink(filePath);
        } catch {
          /* ignore */
        }
        downloadState = {
          state: "error",
          label: "",
          filePath: "",
          error: `安装包校验失败（SHA256 不匹配），已删除损坏文件`,
          percent: -1,
          shaOk: false,
        };
        broadcast("app:updateDownload", downloadState);
        return downloadState;
      }
    }

    downloadState = {
      state: "done",
      label: expected
        ? "下载完成（SHA256 已校验），请运行安装包覆盖安装（勿删文档/大帅墨枢目录）"
        : "下载完成（服务端未提供 SHA256），请运行安装包覆盖安装（勿删文档/大帅墨枢目录）",
      filePath,
      error: "",
      percent: 100,
      shaOk: expected ? true : null,
    };
    broadcast("app:updateDownload", downloadState);
  } catch (e) {
    if (downloadAbort?.signal?.aborted) {
      downloadState = {
        state: "canceled",
        label: "已取消",
        filePath: "",
        error: "",
        percent: -1,
        shaOk: null,
      };
    } else {
      downloadState = {
        state: "error",
        label: "",
        filePath: "",
        error: e && e.message ? e.message : String(e),
        percent: -1,
        shaOk: null,
      };
    }
    broadcast("app:updateDownload", downloadState);
  }
  return downloadState;
}

function cancelDownload() {
  if (downloadState.state === "downloading") {
    downloadAbort?.abort();
  }
  return downloadState;
}

async function openInstaller(filePath) {
  const p = filePath || downloadState.filePath;
  if (!p || !fs.existsSync(p)) return { ok: false, message: "安装包不存在" };
  await shell.openPath(p);
  return {
    ok: true,
    message:
      "已打开安装包，请按向导覆盖安装。API Key、配置与「文档/大帅墨枢」下的书稿都会保留。",
  };
}

async function checkAndPrompt(settings) {
  const result = await probeUpdate(settings || {});
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!result.remote) {
    await dialog.showMessageBox(win || undefined, {
      type: "info",
      title: "检查更新",
      message: "暂无法检查更新",
      detail:
        result.hint +
        "\n\n配置与书稿在本地用户数据目录与「文档/大帅墨枢」，与安装目录分开；覆盖/覆盖安装一般不会删除它们。",
    });
    return { ...result, message: result.hint };
  }
  if (!result.hasUpdate) {
    await dialog.showMessageBox(win || undefined, {
      type: "info",
      title: "检查更新",
      message: "已是最新版本",
      detail: result.hint,
    });
    return { ...result, message: result.hint };
  }
  const changelog = String(result.remote.changelog || "").trim();
  const force = Boolean(result.forceUpdate);
  const box = await dialog.showMessageBox(win || undefined, {
    type: force ? "warning" : "info",
    title: force ? "必须更新" : "发现新版本",
    message: `大帅墨枢 ${result.remote.versionName || result.remote.versionCode}`,
    detail:
      (changelog ? `更新说明：\n${changelog}\n\n` : "") +
      (force ? "此版本为强制更新，请尽快下载安装。\n" : "") +
      "下载安装包后覆盖安装即可。\n配置（API Key 等）与书稿不会因此丢失。",
    buttons: force ? ["下载安装包", "退出"] : ["下载安装包", "以后"],
    defaultId: 0,
    cancelId: 1,
  });
  if (box.response === 0) {
    const dl = await downloadUpdate(settings || {});
    if (dl.state === "done" && dl.filePath) {
      const run = await dialog.showMessageBox(win || undefined, {
        type: "question",
        title: "下载完成",
        message: "是否立即运行安装程序？",
        detail: dl.filePath,
        buttons: ["运行安装", "打开所在文件夹", "关闭"],
        defaultId: 0,
      });
      if (run.response === 0) await openInstaller(dl.filePath);
      if (run.response === 1) shell.showItemInFolder(dl.filePath);
    }
  } else if (force) {
    app.isQuitting = true;
    app.quit();
  }
  return { ...result, message: result.hint };
}

function getDataPathsInfo() {
  return {
    userData: app.getPath("userData"),
    documentsProjects: path.join(app.getPath("documents"), "大帅墨枢"),
    versionName: getAppVersionName(),
    versionCode: APP_VERSION_CODE,
    appKey: APP_UPDATE_KEY,
    updateBase: PUBLIC_UPDATE_BASE,
    note: "配置与 API Key 在 userData；书稿默认在「文档/大帅墨枢」。覆盖安装请勿删除这些目录。",
  };
}

function isForceUpdateBlocking() {
  return Boolean(lastProbe.hasUpdate && lastProbe.forceUpdate);
}

module.exports = {
  get APP_VERSION_NAME() {
    return getAppVersionName();
  },
  APP_VERSION_CODE,
  APP_UPDATE_KEY,
  APP_UPDATE_KEY_BETA,
  PUBLIC_UPDATE_BASE,
  getAppVersionName,
  warnIfVersionMismatch,
  probeUpdate,
  checkAndPrompt,
  downloadUpdate,
  cancelDownload,
  openInstaller,
  getLastProbe: () => lastProbe,
  getDownloadState: () => downloadState,
  getDataPathsInfo,
  isForceUpdateBlocking,
  resolveUpdateAppKey,
};
