/**
 * GET /api/app-meta/{appKey} — 公告与维护模式。
 * 404 时优雅降级为空公告。
 */
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const PUBLIC_UPDATE_BASE = "https://1ph1hf8043323.vicp.fun";
const APP_KEY = "dashuai-moshu";

function cachePath() {
  return path.join(app.getPath("userData"), "license", "app-meta.json");
}

function normalizeBase(u) {
  return String(u || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/https?:\/\/111\.229\.202\.251:8687/gi, PUBLIC_UPDATE_BASE)
    .replace(/https?:\/\/1ph1hf8043323\.vicp\.fun:8687/gi, PUBLIC_UPDATE_BASE);
}

function emptyMeta() {
  return {
    announcements: [],
    maintenance: { enabled: false, message: "" },
    fetchedAt: Date.now(),
    fromCache: false,
    ok: true,
    status: 200,
  };
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(data) {
  await fsp.mkdir(path.dirname(cachePath()), { recursive: true });
  await fsp.writeFile(cachePath(), JSON.stringify(data, null, 2), "utf8");
}

function normalize(raw, status) {
  if (!raw || typeof raw !== "object") return emptyMeta();
  const root = raw;
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const announcementsRaw = Array.isArray(data.announcements) ? data.announcements : [];
  const announcements = announcementsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = String(item.id || "").trim();
      if (!id) return null;
      return {
        id,
        title: String(item.title || ""),
        body: String(item.body || item.content || ""),
        level: String(item.level || "info"),
        force: Boolean(item.force),
        minVersionCode: Number(item.minVersionCode ?? 0),
        maxVersionCode: Number(item.maxVersionCode ?? 999999999),
        expireAt: item.expireAt == null ? null : String(item.expireAt),
      };
    })
    .filter(Boolean);
  const m =
    data.maintenance && typeof data.maintenance === "object" ? data.maintenance : {};
  return {
    announcements,
    maintenance: {
      enabled: Boolean(m.enabled),
      message: String(m.message || ""),
    },
    shopUrl: data.shopUrl != null ? String(data.shopUrl) : undefined,
    xianyuTip: data.xianyuTip != null ? String(data.xianyuTip) : undefined,
    fetchedAt: Date.now(),
    fromCache: false,
    ok: true,
    status: status || 200,
  };
}

async function fetchAppMeta(settings) {
  const apiBase = normalizeBase((settings && settings.updateApiBase) || "") || PUBLIC_UPDATE_BASE;
  const url = `${apiBase}/api/app-meta/${APP_KEY}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404) {
      const empty = emptyMeta();
      empty.status = 404;
      empty.message = "公告接口尚未部署（404），已降级为空";
      await writeCache(empty);
      return empty;
    }
    if (!res.ok) {
      const cached = readCache();
      if (cached) {
        return { ...cached, fromCache: true, ok: false, status: res.status };
      }
      const empty = emptyMeta();
      empty.ok = false;
      empty.status = res.status;
      return empty;
    }
    const json = await res.json();
    const meta = normalize(json, res.status);
    await writeCache(meta);
    return meta;
  } catch (e) {
    const cached = readCache();
    if (cached) {
      return {
        ...cached,
        fromCache: true,
        ok: false,
        message: e && e.message ? e.message : String(e),
      };
    }
    const empty = emptyMeta();
    empty.ok = false;
    empty.message = e && e.message ? e.message : String(e);
    return empty;
  }
}

function getCachedMeta() {
  return readCache() || emptyMeta();
}

module.exports = {
  fetchAppMeta,
  getCachedMeta,
  APP_KEY,
  PUBLIC_UPDATE_BASE,
};
