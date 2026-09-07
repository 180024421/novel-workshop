const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moshu", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (s) => ipcRenderer.invoke("settings:set", s),
  getProviders: () => ipcRenderer.invoke("providers:get"),
  setProviders: (list) => ipcRenderer.invoke("providers:set", list),
  listRecent: () => ipcRenderer.invoke("recent:list"),
  removeRecent: (projectPath) => ipcRenderer.invoke("recent:remove", projectPath),
  renameRecent: (payload) => ipcRenderer.invoke("recent:rename", payload),
  pickFolder: () => ipcRenderer.invoke("project:pickFolder"),
  createProject: (payload) => ipcRenderer.invoke("project:create", payload),
  createProjectDefault: (payload) => ipcRenderer.invoke("project:createDefault", payload),
  openProject: (folder) => ipcRenderer.invoke("project:open", folder),
  readText: (p) => ipcRenderer.invoke("fs:readText", p),
  writeText: (p, c) => ipcRenderer.invoke("fs:writeText", p, c),
  readJson: (p, fb) => ipcRenderer.invoke("fs:readJson", p, fb),
  writeJson: (p, d) => ipcRenderer.invoke("fs:writeJson", p, d),
  deletePath: (p) => ipcRenderer.invoke("fs:deletePath", p),
  listDir: (p) => ipcRenderer.invoke("fs:list", p),
  joinPath: (...parts) => ipcRenderer.invoke("fs:join", ...parts),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  pickFiles: (opts) => ipcRenderer.invoke("dialog:pickFiles", opts),
  pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  saveFile: (opts) => ipcRenderer.invoke("dialog:saveFile", opts),
  writeBinary: (p, base64) => ipcRenderer.invoke("fs:writeBinary", p, base64),
  platform: () => ipcRenderer.invoke("app:platform"),
  listPacks: () => ipcRenderer.invoke("packs:list"),
  listUserPacks: () => ipcRenderer.invoke("packs:listUser"),
  importPackZip: (zipPath, opts) => ipcRenderer.invoke("packs:importZip", zipPath, opts),
  checkForUpdates: () => ipcRenderer.invoke("app:checkUpdates"),
  probeUpdate: () => ipcRenderer.invoke("app:probeUpdate"),
  downloadUpdate: () => ipcRenderer.invoke("app:downloadUpdate"),
  openInstaller: (filePath) => ipcRenderer.invoke("app:openInstaller", filePath),
  cancelUpdateDownload: () => ipcRenderer.invoke("app:cancelUpdateDownload"),
  getDataPaths: () => ipcRenderer.invoke("app:dataPaths"),
  getUpdateStatus: () => ipcRenderer.invoke("app:getUpdateStatus"),
  onUpdateProbe: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("app:updateProbe", handler);
    return () => ipcRenderer.removeListener("app:updateProbe", handler);
  },
  onUpdateDownload: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("app:updateDownload", handler);
    return () => ipcRenderer.removeListener("app:updateDownload", handler);
  },
  getSession: () => ipcRenderer.invoke("session:get"),
  setSession: (s) => ipcRenderer.invoke("session:set", s),
  getUsage: () => ipcRenderer.invoke("usage:get"),
  addUsage: (delta) => ipcRenderer.invoke("usage:add", delta),
  zipProjectBackup: (payload) => ipcRenderer.invoke("project:zipBackup", payload),
  exportVolumeZip: (payload) => ipcRenderer.invoke("project:exportVolumeZip", payload),
  showItemInFolder: (filePath) => ipcRenderer.invoke("shell:showItemInFolder", filePath),
  openPath: (target) => ipcRenderer.invoke("shell:openPath", target),
  readImportText: (filePath) => ipcRenderer.invoke("fs:readImportText", filePath),
  minimizeToTray: () => ipcRenderer.invoke("app:minimizeToTray"),
  showMainWindow: () => ipcRenderer.invoke("app:showMain"),
  notify: (payload) => ipcRenderer.invoke("app:notify", payload),
  chat: (payload) => ipcRenderer.invoke("llm:chat", payload),
  abortChat: (requestId) => ipcRenderer.invoke("llm:abort", requestId),
  onChatDelta: (cb) => {
    const handler = (_e, text) => cb(text);
    ipcRenderer.on("llm:delta", handler);
    return () => ipcRenderer.removeListener("llm:delta", handler);
  },
  // App License
  getDeviceFingerprint: () => ipcRenderer.invoke("license:fingerprint"),
  licenseStatus: () => ipcRenderer.invoke("license:status"),
  licenseRedeem: (cardCode) => ipcRenderer.invoke("license:redeem", cardCode),
  licenseUnbind: () => ipcRenderer.invoke("license:unbind"),
  licenseCached: () => ipcRenderer.invoke("license:cached"),
  // App meta / announcements
  fetchAppMeta: () => ipcRenderer.invoke("appMeta:fetch"),
  getCachedAppMeta: () => ipcRenderer.invoke("appMeta:cached"),
});
