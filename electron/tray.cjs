/**
 * 系统托盘：批量写时可最小化到托盘，完成后通知
 */
const { Tray, Menu, nativeImage, Notification, BrowserWindow, app } = require("electron");
const path = require("path");

let tray = null;

function iconPath() {
  const p = path.join(__dirname, "..", "build", "icon.png");
  return p;
}

function getMainWindow() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) || null;
}

function ensureTray() {
  if (tray && !tray.isDestroyed()) return tray;
  let img = nativeImage.createFromPath(iconPath());
  if (img.isEmpty()) {
    img = nativeImage.createEmpty();
  } else if (process.platform === "win32") {
    img = img.resize({ width: 16, height: 16 });
  }
  tray = new Tray(img);
  tray.setToolTip("大帅墨枢");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示主窗口",
        click: () => showMain(),
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("double-click", () => showMain());
  return tray;
}

function showMain() {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function minimizeToTray() {
  ensureTray();
  const win = getMainWindow();
  if (win) win.hide();
  return { ok: true };
}

function notify(title, body) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: title || "大帅墨枢", body: body || "" });
      n.on("click", () => showMain());
      n.show();
    }
  } catch {
    /* ignore */
  }
  return { ok: true };
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  ensureTray,
  minimizeToTray,
  showMain,
  notify,
  destroyTray,
};
