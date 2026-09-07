const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const updater = require("./updater.cjs");
const tray = require("./tray.cjs");
const projectBackup = require("./project-backup.cjs");
const license = require("./license.cjs");
const appMeta = require("./app-meta.cjs");
const JSZip = require("jszip");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;

function appendCrashLog(kind, err) {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fssync.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "crash.log");
    const stamp = new Date().toISOString();
    const msg =
      err && typeof err === "object" && err.stack
        ? String(err.stack)
        : err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err);
    const line = `[${stamp}] ${kind}\n${msg}\n\n`;
    fssync.appendFileSync(file, line, "utf8");
    // soft rotate ~1.5MB
    try {
      const st = fssync.statSync(file);
      if (st.size > 1.5 * 1024 * 1024) {
        const bak = path.join(dir, "crash.log.1");
        try {
          fssync.unlinkSync(bak);
        } catch {
          /* ignore */
        }
        fssync.renameSync(file, bak);
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* never throw from crash logger */
  }
}

process.on("uncaughtException", (err) => {
  appendCrashLog("uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  appendCrashLog("unhandledRejection", reason);
});

const RECENT_FILE = () => path.join(app.getPath("userData"), "recent-projects.json");
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");
const PROVIDERS_FILE = () => path.join(app.getPath("userData"), "providers.json");
const SESSION_FILE = () => path.join(app.getPath("userData"), "session.json");
const USAGE_FILE = () => path.join(app.getPath("userData"), "usage.json");
const USER_PACKS_DIR = () => path.join(app.getPath("userData"), "packs");

const PROJECT_DIRS = [
  "ideas",
  "bible",
  "characters",
  "outlines",
  "beats",
  "chapters",
  "continuity",
  "refs",
  "kb",
  "revisions",
  "prompts",
  "export",
  "meta",
];

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0c0b09",
    title: "大帅墨枢",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // 点关闭：进托盘，不直接退出（避免批量写挂机时误关）
  mainWindow.on("close", (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    try {
      tray.ensureTray();
      mainWindow.hide();
    } catch {
      app.isQuitting = true;
      mainWindow.destroy();
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // 启动后静默探测更新（不弹窗）；配置在 userData，与程序安装目录分离
  setTimeout(() => {
    void (async () => {
      try {
        try {
          updater.warnIfVersionMismatch();
        } catch {
          /* ignore */
        }
        const settings = await readJson(SETTINGS_FILE(), {});
        const tasks = [];
        if (settings.checkUpdateOnLaunch !== false) {
          tasks.push(updater.probeUpdate(settings));
        }
        tasks.push(
          (async () => {
            try {
              const st = await license.status(settings);
              if (st && st.settingsPatch) {
                const next = { ...settings, ...st.settingsPatch };
                await writeJson(SETTINGS_FILE(), next);
              }
            } catch {
              /* offline ok */
            }
          })()
        );
        tasks.push(appMeta.fetchAppMeta(settings).catch(() => null));
        await Promise.all(tasks);
      } catch {
        /* ignore */
      }
    })();
  }, 2500);
}

app.whenReady().then(() => {
  createWindow();
  try {
    tray.ensureTray();
  } catch {
    /* ignore */
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else tray.showMain();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  tray.destroyTray();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && app.isQuitting) {
    tray.destroyTray();
    app.quit();
  }
});

ipcMain.handle("settings:get", async () =>
  readJson(SETTINGS_FILE(), {
    defaultModel: "小说",
    stream: true,
    routeOutline: "复杂",
    routeChapter: "小说",
    routeCheck: "复杂",
    writePipelineEnabled: true,
    writePipelineWordGate: true,
    writePipelineBeatsCheck: true,
    writePipelinePolish: true,
    writePipelineMinRatio: 0.9,
    writePipelineMaxRatio: 1.15,
    defaultChapterWords: 2500,
    updateApiBase: "",
    checkUpdateOnLaunch: true,
    autoResume: true,
    editorFontSize: 16,
    focusMode: false,
    dailyWordGoal: 2000,
  })
);

ipcMain.handle("settings:set", async (_e, next) => {
  await writeJson(SETTINGS_FILE(), next);
  return next;
});

ipcMain.handle("providers:get", async () => {
  const saved = await readJson(PROVIDERS_FILE(), null);
  return saved;
});

ipcMain.handle("providers:set", async (_e, list) => {
  await writeJson(PROVIDERS_FILE(), list);
  return list;
});

ipcMain.handle("recent:list", async () => readJson(RECENT_FILE(), []));

ipcMain.handle("recent:remove", async (_e, projectPath) => {
  const list = await readJson(RECENT_FILE(), []);
  const next = list.filter((x) => x.path !== projectPath);
  await writeJson(RECENT_FILE(), next);
  return next;
});

ipcMain.handle("recent:rename", async (_e, { path: projectPath, title }) => {
  const nextTitle = String(title || "").trim() || path.basename(projectPath);
  const list = await readJson(RECENT_FILE(), []);
  const next = list.map((x) =>
    x.path === projectPath ? { ...x, title: nextTitle } : x
  );
  await writeJson(RECENT_FILE(), next);

  const projFile = path.join(projectPath, "project.json");
  if (fssync.existsSync(projFile)) {
    const project = await readJson(projFile, null);
    if (project && typeof project === "object") {
      project.title = nextTitle;
      project.updatedAt = new Date().toISOString();
      await writeJson(projFile, project);
    }
  }
  return next;
});

ipcMain.handle("session:get", async () => {
  const s = await readJson(SESSION_FILE(), null);
  return s && s.root ? s : null;
});

ipcMain.handle("session:set", async (_e, next) => {
  if (!next) {
    try {
      await fs.unlink(SESSION_FILE());
    } catch {
      /* ignore */
    }
    return null;
  }
  await writeJson(SESSION_FILE(), next);
  return next;
});

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

ipcMain.handle("usage:get", async () => readJson(USAGE_FILE(), { days: {} }));

ipcMain.handle("logs:getCrash", async () => {
  try {
    const file = path.join(app.getPath("userData"), "logs", "crash.log");
    if (!fssync.existsSync(file)) {
      return { ok: true, text: "", path: file, bytes: 0 };
    }
    const text = await fs.readFile(file, "utf8");
    const st = fssync.statSync(file);
    return { ok: true, text, path: file, bytes: st.size };
  } catch (e) {
    return {
      ok: false,
      text: "",
      path: "",
      bytes: 0,
      message: e instanceof Error ? e.message : String(e),
    };
  }
});

ipcMain.handle("logs:clearCrash", async () => {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    const file = path.join(dir, "crash.log");
    const bak = path.join(dir, "crash.log.1");
    for (const p of [file, bak]) {
      try {
        await fs.unlink(p);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("usage:add", async (_e, delta) => {
  const store = await readJson(USAGE_FILE(), { days: {} });
  if (!store.days) store.days = {};
  const key = todayKey();
  const cur = store.days[key] || { words: 0, costCny: 0, writeOk: 0, writeFail: 0 };
  const next = {
    words: cur.words + Math.max(0, Math.round(delta?.words || 0)),
    costCny: cur.costCny + Math.max(0, Number(delta?.costCny) || 0),
    writeOk: (cur.writeOk || 0) + Math.max(0, Math.round(delta?.writeOk || 0)),
    writeFail: (cur.writeFail || 0) + Math.max(0, Math.round(delta?.writeFail || 0)),
  };
  store.days[key] = next;
  // 只保留近 90 天
  const keys = Object.keys(store.days).sort();
  if (keys.length > 90) {
    for (const k of keys.slice(0, keys.length - 90)) delete store.days[k];
  }
  await writeJson(USAGE_FILE(), store);
  return next;
});

ipcMain.handle("project:zipBackup", async (_e, { root, title }) =>
  projectBackup.zipProjectFolder(root, title)
);

ipcMain.handle("project:exportVolumeZip", async (_e, payload) =>
  projectBackup.exportVolumeZip(payload || {})
);

ipcMain.handle("shell:showItemInFolder", async (_e, filePath) =>
  projectBackup.openInFolder(filePath)
);

ipcMain.handle("shell:openPath", async (_e, target) => projectBackup.openPath(target));

ipcMain.handle("fs:readImportText", async (_e, filePath) =>
  projectBackup.readImportText(filePath)
);

ipcMain.handle("app:minimizeToTray", () => tray.minimizeToTray());

ipcMain.handle("app:showMain", () => {
  tray.showMain();
  return { ok: true };
});

ipcMain.handle("app:notify", (_e, { title, body }) => tray.notify(title, body));

async function pushRecent(projectPath, title) {
  const list = await readJson(RECENT_FILE(), []);
  const next = [
    { path: projectPath, title: title || path.basename(projectPath), openedAt: Date.now() },
    ...list.filter((x) => x.path !== projectPath),
  ].slice(0, 12);
  await writeJson(RECENT_FILE(), next);
  return next;
}

ipcMain.handle("project:pickFolder", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "选择或创建小说项目文件夹",
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

ipcMain.handle("project:create", async (_e, { folder, title, genre }) => {
  return initProject(folder, title, genre);
});

ipcMain.handle("project:createDefault", async (_e, { title, genre }) => {
  const safe =
    String(title || "我的小说")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .trim() || "我的小说";
  const base = path.join(app.getPath("documents"), "大帅墨枢");
  await fs.mkdir(base, { recursive: true });
  let root = path.join(base, safe);
  if (fssync.existsSync(path.join(root, "project.json"))) {
    root = path.join(base, `${safe}-${Date.now()}`);
  }
  return initProject(root, title || safe, genre);
});

async function initProject(root, title, genre) {
  await fs.mkdir(root, { recursive: true });
  for (const d of PROJECT_DIRS) {
    await fs.mkdir(path.join(root, d), { recursive: true });
  }
  const project = {
    id: `proj_${Date.now()}`,
    title: title || "我的小说",
    genre: genre || "通用",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stage: { bibleLocked: false, outlineLocked: false },
    defaultModel: "小说",
  };
  await writeJson(path.join(root, "project.json"), project);
  await fs.writeFile(path.join(root, "ideas", "seed.md"), "", "utf8");
  await fs.writeFile(path.join(root, "bible", "world.md"), "", "utf8");
  await fs.writeFile(
    path.join(root, "prompts", "style.md"),
    `# 写作工艺（强制）

## 禁止
- 啰嗦、重复、电报文、顶真连环、标语体、口号体
- 讲课腔、总结腔、空洞形容词、说教式「他知道/他感到自己必须」

## 必须
- 人物丰满（欲望/忌讳/声口）、画面感（感官细节）、张力（阻碍与代价）
- 合理引经据典与修辞（点到为止）、信息增量、对白有功能、视角稳定
- 章末钩子须是具体未决事件

## 文风
- 对白自然，有画面与节奏
- 禁止流水账与口号腔
- 人物声口要区分
`,
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "prompts", "taboo.md"),
    `- 总之
- 总而言之
- 不禁
- 目光如炬
- 嘴角微微上扬
- 杀气腾腾
- 心中暗道
- 这一刀，注定
- 改写命运
- 邪不胜正
- 我们一定能赢
- 他明白了
- 从今往后
- 无比强大
- 极其恐怖
- 震撼人心
- 命运的齿轮
- 更大的风暴
- 历史将会记住
- 正义必将
`,
    "utf8"
  );
  await fs.writeFile(path.join(root, "outlines", "outline.md"), "", "utf8");
  await writeJson(path.join(root, "continuity", "hooks.json"), { items: [], updatedAt: null });
  await writeJson(path.join(root, "revisions", "index.json"), { items: [] });
  await fs.mkdir(path.join(root, "export"), { recursive: true });
  await writeJson(path.join(root, "kb", "index.json"), { chunks: [], updatedAt: null });
  await pushRecent(root, project.title);
  return { root, project };
}

ipcMain.handle("project:open", async (_e, folder) => {
  const projFile = path.join(folder, "project.json");
  if (!fssync.existsSync(projFile)) {
    throw new Error("所选文件夹不是大帅墨枢项目（缺少 project.json）");
  }
  const project = await readJson(projFile, null);
  await pushRecent(folder, project?.title);
  return { root: folder, project };
});

ipcMain.handle("fs:readText", async (_e, filePath) => {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
});

ipcMain.handle("fs:writeText", async (_e, filePath, content) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content ?? "", "utf8");
  return true;
});

ipcMain.handle("fs:readJson", async (_e, filePath, fallback) => readJson(filePath, fallback ?? null));

ipcMain.handle("fs:writeJson", async (_e, filePath, data) => {
  await writeJson(filePath, data);
  return true;
});

ipcMain.handle("fs:deletePath", async (_e, filePath) => {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (e) {
    if (e && e.code === "ENOENT") return true;
    throw e;
  }
});

ipcMain.handle("fs:list", async (_e, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile());
    const rows = await Promise.all(
      files.map(async (e) => {
        const full = path.join(dirPath, e.name);
        let mtimeMs = 0;
        let size = 0;
        try {
          const st = await fs.stat(full);
          mtimeMs = st.mtimeMs || 0;
          size = st.size || 0;
        } catch {
          /* ignore */
        }
        return { name: e.name, path: full, mtimeMs, size };
      })
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  } catch {
    return [];
  }
});

ipcMain.handle("fs:join", (_e, ...parts) => path.join(...parts));

ipcMain.handle("shell:openExternal", async (_e, url) => {
  await shell.openExternal(url);
});

ipcMain.handle("dialog:pickFiles", async (_e, opts) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: opts?.filters || [{ name: "文本", extensions: ["txt", "md", "markdown"] }],
    title: opts?.title || "选择文件",
  });
  if (res.canceled) return [];
  return res.filePaths;
});

ipcMain.handle("dialog:saveFile", async (_e, opts) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: opts?.defaultPath || "全书.md",
    filters: opts?.filters || [
      { name: "Markdown", extensions: ["md"] },
      { name: "文本", extensions: ["txt"] },
    ],
  });
  if (res.canceled || !res.filePath) return null;
  await fs.mkdir(path.dirname(res.filePath), { recursive: true });
  const encoding = opts?.encoding === "base64" ? "base64" : "utf8";
  const data =
    encoding === "base64"
      ? Buffer.from(String(opts?.content || ""), "base64")
      : String(opts?.content ?? "");
  await fs.writeFile(res.filePath, data);
  return res.filePath;
});

ipcMain.handle("fs:writeBinary", async (_e, filePath, base64) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(String(base64 || ""), "base64"));
  return true;
});

ipcMain.handle("app:platform", () => ({
  platform: process.platform,
  arch: process.arch,
}));

ipcMain.handle("dialog:pickDirectory", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "选择扩展包文件夹",
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

/** 内置 packs：开发态用项目根 packs/，打包后用 resources/packs */
ipcMain.handle("packs:list", async () => {
  const candidates = [
    path.join(__dirname, "..", "packs"),
    path.join(process.resourcesPath || "", "packs"),
  ];
  const dirs = [];
  for (const base of candidates) {
    try {
      const entries = await fs.readdir(base, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) dirs.push(path.join(base, e.name));
      }
      if (dirs.length) break;
    } catch {
      /* next */
    }
  }
  return dirs;
});

ipcMain.handle("packs:listUser", async () => {
  const base = USER_PACKS_DIR();
  try {
    await fs.mkdir(base, { recursive: true });
    const entries = await fs.readdir(base, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(base, e.name));
  } catch {
    return [];
  }
});

/**
 * 导入本地扩展包 zip → userData/packs/{id}
 * 校验 pack.json：id / name / files
 */
ipcMain.handle("packs:importZip", async (_e, zipPath, opts) => {
  const overwrite = Boolean(opts?.overwrite);
  if (!zipPath || !fssync.existsSync(zipPath)) {
    return { ok: false, message: "找不到 zip 文件" };
  }
  try {
    const buf = await fs.readFile(zipPath);
    const zip = await JSZip.loadAsync(buf);
    // 找 pack.json（允许在根或一级子目录）
    let packEntry = zip.file("pack.json");
    let rootPrefix = "";
    if (!packEntry) {
      const names = Object.keys(zip.files);
      const hit = names.find((n) => /(^|\/)pack\.json$/i.test(n) && !n.endsWith("/"));
      if (hit) {
        packEntry = zip.file(hit);
        const idx = hit.replace(/\\/g, "/").lastIndexOf("/");
        rootPrefix = idx >= 0 ? hit.slice(0, idx + 1) : "";
      }
    }
    if (!packEntry) {
      return { ok: false, message: "zip 内缺少 pack.json" };
    }
    const raw = await packEntry.async("string");
    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch {
      return { ok: false, message: "pack.json 不是合法 JSON" };
    }
    if (!manifest?.id || !manifest?.name || !manifest?.files) {
      return { ok: false, message: "pack.json 需包含 id、name、files" };
    }
    const safeId = String(manifest.id)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .trim();
    if (!safeId) return { ok: false, message: "无效的 pack id" };

    const dest = path.join(USER_PACKS_DIR(), safeId);
    if (fssync.existsSync(dest) && !overwrite) {
      return {
        ok: false,
        needsOverwrite: true,
        id: safeId,
        name: manifest.name,
        message: `已存在同 id 扩展包「${manifest.name || safeId}」，是否覆盖？`,
      };
    }

    await fs.mkdir(dest, { recursive: true });
    // 清空旧内容（覆盖）
    if (overwrite && fssync.existsSync(dest)) {
      const old = await fs.readdir(dest);
      for (const name of old) {
        await fs.rm(path.join(dest, name), { recursive: true, force: true });
      }
    }

    const entries = Object.keys(zip.files);
    for (const name of entries) {
      const entry = zip.files[name];
      if (!entry || entry.dir) continue;
      let rel = name.replace(/\\/g, "/");
      if (rootPrefix && rel.startsWith(rootPrefix)) {
        rel = rel.slice(rootPrefix.length);
      }
      if (!rel || rel.includes("..")) continue;
      const outPath = path.join(dest, ...rel.split("/").filter(Boolean));
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      const content = await entry.async("nodebuffer");
      await fs.writeFile(outPath, content);
    }

    return {
      ok: true,
      message: `已导入「${manifest.name}」`,
      id: safeId,
      name: manifest.name,
      dir: dest,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("app:checkUpdates", async () => {
  const settings = await readJson(SETTINGS_FILE(), {});
  const r = await updater.checkAndPrompt(settings);
  return {
    ok: r.ok !== false,
    message: r.message || r.hint || "",
    hasUpdate: Boolean(r.hasUpdate),
    remote: r.remote,
  };
});

ipcMain.handle("app:probeUpdate", async () => {
  const settings = await readJson(SETTINGS_FILE(), {});
  return updater.probeUpdate(settings);
});

ipcMain.handle("app:downloadUpdate", async () => {
  const settings = await readJson(SETTINGS_FILE(), {});
  return updater.downloadUpdate(settings);
});

ipcMain.handle("app:openInstaller", async (_e, filePath) => updater.openInstaller(filePath));

ipcMain.handle("app:cancelUpdateDownload", () => updater.cancelDownload());

ipcMain.handle("app:dataPaths", () => updater.getDataPathsInfo());

ipcMain.handle("app:getUpdateStatus", () => ({
  probe: updater.getLastProbe(),
  download: updater.getDownloadState(),
  forceUpdate: updater.isForceUpdateBlocking(),
}));

/** 直连上游 OpenAI 兼容接口（主进程，无 CORS） */
const llmAbortControllers = new Map();

ipcMain.handle("llm:abort", (_e, requestId) => {
  const ac = llmAbortControllers.get(requestId);
  if (ac) {
    ac.abort();
    llmAbortControllers.delete(requestId);
    return true;
  }
  return false;
});

ipcMain.handle("llm:chat", async (_e, payload) => {
  const {
    requestId = `req_${Date.now()}`,
    baseUrl,
    apiKey,
    model,
    messages,
    stream,
    temperature = 0.85,
    max_tokens = 8192,
  } = payload || {};
  if (!baseUrl || !apiKey || !model) {
    throw new Error("缺少 baseUrl / apiKey / model");
  }
  const ac = new AbortController();
  llmAbortControllers.set(requestId, ac);
  const url = `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: Boolean(stream),
        temperature,
        max_tokens,
      }),
      signal: ac.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`上游 ${res.status}: ${text.slice(0, 300)}`);
    }

    if (!stream) {
      const json = await res.json();
      return {
        content: json?.choices?.[0]?.message?.content ?? "",
        providerModel: model,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let full = "";
    let buffer = "";
    const sender = mainWindow?.webContents;

    while (true) {
      if (ac.signal.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new Error("已取消");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            sender?.send("llm:delta", delta);
          }
        } catch {
          /* ignore */
        }
      }
    }
    return { content: full, providerModel: model };
  } catch (e) {
    if (ac.signal.aborted || (e && e.name === "AbortError")) {
      throw new Error("已取消");
    }
    throw e;
  } finally {
    llmAbortControllers.delete(requestId);
  }
});

ipcMain.handle("license:fingerprint", () => license.getFingerprintInfo());
ipcMain.handle("license:cached", () => license.readCachedSummary());
ipcMain.handle("license:status", async () => {
  const settings = await readJson(SETTINGS_FILE(), {});
  const st = await license.status(settings);
  if (st && st.settingsPatch) {
    const next = { ...settings, ...st.settingsPatch };
    await writeJson(SETTINGS_FILE(), next);
  }
  return st;
});
ipcMain.handle("license:redeem", async (_e, cardCode) => {
  const settings = await readJson(SETTINGS_FILE(), {});
  const st = await license.redeem(settings, cardCode);
  if (st && st.settingsPatch) {
    const next = { ...settings, ...st.settingsPatch };
    if (cardCode) next.licenseKey = String(cardCode).trim();
    await writeJson(SETTINGS_FILE(), next);
  }
  return st;
});
ipcMain.handle("license:unbind", async () => {
  const settings = await readJson(SETTINGS_FILE(), {});
  const st = await license.unbind(settings);
  if (st && st.settingsPatch) {
    const next = { ...settings, ...st.settingsPatch };
    await writeJson(SETTINGS_FILE(), next);
  }
  return st;
});
ipcMain.handle("appMeta:fetch", async () => {
  const settings = await readJson(SETTINGS_FILE(), {});
  return appMeta.fetchAppMeta(settings);
});
ipcMain.handle("appMeta:cached", () => appMeta.getCachedMeta());
