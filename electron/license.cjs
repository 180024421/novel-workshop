/**
 * 大帅墨枢 · App License（设备指纹 + 卡密 + Ed25519 ticket）
 * 私钥仅服务端；此处只嵌公钥验票。
 */
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const os = require("os");
const { encryptedFetch } = require("./crypto-transport.cjs");

const APP_KEY_STABLE = "dashuai-moshu";
const APP_KEY_BETA = "dashuai-moshu-beta";
const PUBLIC_UPDATE_BASE = "https://1ph1hf8043323.vicp.fun";
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_GRACE_MS = 72 * 60 * 60 * 1000;
const LICENSE_SCOPES = Object.freeze({
  redeem: "app-license.redeem",
  status: "app-license.status",
  unbind: "app-license.unbind",
});

/**
 * Ed25519 SPKI base64url — 与 jiaoben APP_LICENSE_TICKET_PUBLIC_KEY / desk-reader 一致。
 * 可用环境变量 APP_LICENSE_TICKET_PUBLIC_KEY 或 VITE_APP_LICENSE_PUBLIC_KEY 覆盖。
 */
const EMBEDDED_PUBLIC_KEY_B64URL =
  process.env.APP_LICENSE_TICKET_PUBLIC_KEY ||
  process.env.VITE_APP_LICENSE_PUBLIC_KEY ||
  "MCowBQYDK2VwAyEAPuGiGKcy19RYif-ir-fhnK5Gr9u3vwQ2SZ148GvIaaI";

function licenseDir() {
  return path.join(app.getPath("userData"), "license");
}

function cachePath() {
  return path.join(licenseDir(), "cache.json");
}

function machineIdPath() {
  return path.join(licenseDir(), "machine-id");
}

function decodeBase64Url(value) {
  const padded = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

function normalizeBase(u) {
  return String(u || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/https?:\/\/111\.229\.202\.251:8687/gi, PUBLIC_UPDATE_BASE)
    .replace(/https?:\/\/1ph1hf8043323\.vicp\.fun:8687/gi, PUBLIC_UPDATE_BASE);
}

function resolveAppKey(settings) {
  const ch = String((settings && settings.updateChannel) || "stable").toLowerCase();
  // 授权产品固定 dashuai-moshu；beta 更新频道不改变授权 appKey（卡密同一产品）
  // 若未来 beta 单独发卡，可改为 APP_KEY_BETA
  void APP_KEY_BETA;
  void ch;
  return APP_KEY_STABLE;
}

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function getOrCreateMachineId() {
  try {
    fs.mkdirSync(licenseDir(), { recursive: true });
    if (fs.existsSync(machineIdPath())) {
      const id = fs.readFileSync(machineIdPath(), "utf8").trim();
      if (id) return id;
    }
  } catch {
    /* fall through */
  }
  const id = crypto.randomUUID();
  try {
    fs.mkdirSync(licenseDir(), { recursive: true });
    fs.writeFileSync(machineIdPath(), id, { encoding: "utf8", flag: "wx" });
  } catch {
    try {
      const existing = fs.readFileSync(machineIdPath(), "utf8").trim();
      if (existing) return existing;
    } catch {
      /* ignore */
    }
  }
  return id;
}

/** 稳定设备指纹：优先持久 machine-id；否则 hostname+username+userData 哈希 */
function getDeviceFingerprint() {
  try {
    const mid = getOrCreateMachineId();
    return crypto.createHash("sha256").update(`${APP_KEY_STABLE}:${mid}`).digest("hex");
  } catch {
    const raw = [
      os.hostname(),
      os.userInfo().username,
      app.getPath("userData"),
      process.platform,
      process.arch,
    ].join("|");
    return crypto.createHash("sha256").update(`${APP_KEY_STABLE}:fallback:${raw}`).digest("hex");
  }
}

function getDeviceName() {
  try {
    return os.hostname() || "unknown-device";
  } catch {
    return "unknown-device";
  }
}

function verifyLicenseTicket(ticket, expectedAppKey, expectedRawFingerprint, publicKeyB64Url) {
  const text = String(ticket || "").trim();
  const dot = text.indexOf(".");
  if (dot <= 0 || dot >= text.length - 1) return null;
  let payloadBytes;
  let sigBytes;
  try {
    payloadBytes = decodeBase64Url(text.slice(0, dot));
    sigBytes = decodeBase64Url(text.slice(dot + 1));
  } catch {
    return null;
  }
  try {
    const der = decodeBase64Url(publicKeyB64Url || EMBEDDED_PUBLIC_KEY_B64URL);
    const publicKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    const payload = JSON.parse(payloadBytes.toString("utf8"));
    const version = Number(payload.v ?? 1);
    if (version < 2) return null;
    if (!crypto.verify(null, payloadBytes, publicKey, sigBytes)) return null;
    const ticketExpireAt = Number(payload.exp);
    if (!Number.isFinite(ticketExpireAt) || ticketExpireAt <= Date.now()) return null;
    const appKey = String(payload.a ?? "");
    const rawFingerprint = String(payload.r ?? "");
    if (appKey !== expectedAppKey || rawFingerprint !== expectedRawFingerprint) return null;
    const licenseExpireRaw = payload.e;
    const licenseExpireAt = licenseExpireRaw == null ? null : Number(licenseExpireRaw);
    const timeUnlimited = Number(payload.u) === 1;
    if (
      !timeUnlimited &&
      licenseExpireAt != null &&
      Number.isFinite(licenseExpireAt) &&
      licenseExpireAt <= Date.now()
    ) {
      return null;
    }
    return {
      appKey,
      rawFingerprint,
      licenseId: Number(payload.l ?? 0),
      licenseExpireAt: Number.isFinite(licenseExpireAt) ? licenseExpireAt : null,
      timeUnlimited,
      ticketExpireAt,
    };
  } catch {
    return null;
  }
}

function readCache() {
  return readJsonSync(cachePath(), {});
}

async function writeCache(patch) {
  const prev = readCache();
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  await writeJson(cachePath(), next);
  return next;
}

async function clearTicketCache() {
  const prev = readCache();
  const next = {
    ...prev,
    ticket: "",
    ticketExpireAt: null,
    valid: false,
  };
  await writeJson(cachePath(), next);
  return next;
}

function settingsSummaryFromCache(cache) {
  return {
    licenseActivatedOnline: Boolean(cache.activatedOnline),
    licenseLastOnlineAt: cache.lastOnlineAt || undefined,
    licenseTicketExpireAt: cache.ticketExpireAt || undefined,
    licenseExpireAt: cache.timeUnlimited ? null : cache.licenseExpireAt ?? undefined,
    licenseTimeUnlimited: Boolean(cache.timeUnlimited),
    licensePlanLabel: cache.planLabel || "",
    licenseDeviceCount: cache.deviceCount,
    licenseMaxDevices: cache.maxDevices,
    licenseGraceMs: cache.graceMs ?? DEFAULT_GRACE_MS,
    deviceFingerprint: cache.fingerprint || getDeviceFingerprint(),
  };
}

function unwrapStatus(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("授权服务返回无效数据");
  }
  const envelope = payload;
  const raw =
    envelope.data && typeof envelope.data === "object" ? envelope.data : envelope;
  return { ...raw, valid: Boolean(raw.valid) };
}

function messageFromPayload(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  return String(payload.message || payload.msg || payload.error || fallback);
}

async function postLicense(action, settings, cardCode) {
  const appKey = resolveAppKey(settings);
  const apiBase = normalizeBase((settings && settings.updateApiBase) || "") || PUBLIC_UPDATE_BASE;
  const fingerprint = getDeviceFingerprint();
  const cache = readCache();
  const body = {
    deviceFingerprint: fingerprint,
    deviceName: getDeviceName(),
  };
  if (cardCode) body.cardCode = String(cardCode).trim();
  if (cache.ticket) body.ticket = String(cache.ticket);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const payload = await encryptedFetch(
      `${apiBase}/api/app-license/${appKey}/${action}`,
      LICENSE_SCOPES[action],
      body,
      {
        signal: controller.signal,
      }
    );
    if (payload && typeof payload === "object") {
      const code = Number(payload.code);
      if (payload.success === false || (Number.isFinite(code) && code >= 400)) {
        throw new Error(messageFromPayload(payload, "授权请求失败"));
      }
    }
    return unwrapStatus(payload);
  } finally {
    clearTimeout(timer);
  }
}

async function applyValidStatus(status, settings, cardCode) {
  const appKey = resolveAppKey(settings);
  const fingerprint = getDeviceFingerprint();
  const ticket = typeof status.ticket === "string" ? status.ticket.trim() : "";
  if (!ticket) throw new Error("授权服务未返回可验签票据");
  const claims = verifyLicenseTicket(ticket, appKey, fingerprint, EMBEDDED_PUBLIC_KEY_B64URL);
  if (!claims) throw new Error("授权票据验签失败");

  const cache = await writeCache({
    ticket,
    ticketExpireAt: claims.ticketExpireAt,
    licenseExpireAt: claims.licenseExpireAt,
    timeUnlimited: claims.timeUnlimited,
    activatedOnline: true,
    lastOnlineAt: Date.now(),
    planLabel: status.planLabel || "",
    deviceCount: status.deviceCount,
    maxDevices: status.maxDevices,
    fingerprint,
    cardCodeHint: cardCode ? String(cardCode).trim().slice(0, 8) : readCache().cardCodeHint || "",
    graceMs: (settings && settings.licenseGraceMs) || DEFAULT_GRACE_MS,
    valid: true,
    message: status.message || "授权有效",
  });

  return {
    ...status,
    ticketExpireAt: claims.ticketExpireAt,
    timeUnlimited: claims.timeUnlimited,
    expireAt:
      claims.licenseExpireAt == null ? null : new Date(claims.licenseExpireAt).toISOString(),
    settingsPatch: {
      ...settingsSummaryFromCache(cache),
      ...(cardCode ? { licenseKey: String(cardCode).trim() } : {}),
    },
  };
}

async function status(settings) {
  try {
    const remote = await postLicense("status", settings || {});
    if (!remote.valid) {
      await clearTicketCache();
      return { ...remote, settingsPatch: settingsSummaryFromCache({ activatedOnline: false }) };
    }
    return await applyValidStatus(remote, settings || {});
  } catch (error) {
    const cache = readCache();
    const claims =
      cache.ticket &&
      verifyLicenseTicket(
        cache.ticket,
        resolveAppKey(settings || {}),
        getDeviceFingerprint(),
        EMBEDDED_PUBLIC_KEY_B64URL
      );
    if (claims) {
      return {
        valid: true,
        fromCache: true,
        ticket: cache.ticket,
        ticketExpireAt: claims.ticketExpireAt,
        timeUnlimited: claims.timeUnlimited,
        expireAt:
          claims.licenseExpireAt == null
            ? null
            : new Date(claims.licenseExpireAt).toISOString(),
        planLabel: cache.planLabel,
        deviceCount: cache.deviceCount,
        maxDevices: cache.maxDevices,
        message: `使用已缓存授权（离线可用）：${error && error.message ? error.message : error}`,
        settingsPatch: settingsSummaryFromCache({
          ...cache,
          activatedOnline: true,
          ticketExpireAt: claims.ticketExpireAt,
          licenseExpireAt: claims.licenseExpireAt,
          timeUnlimited: claims.timeUnlimited,
        }),
      };
    }
    throw error;
  }
}

async function redeem(settings, cardCode) {
  const remote = await postLicense("redeem", settings || {}, cardCode);
  if (!remote.valid) {
    return { ...remote, settingsPatch: {} };
  }
  return applyValidStatus(remote, settings || {}, cardCode);
}

async function unbind(settings) {
  try {
    const remote = await postLicense("unbind", settings || {});
    await clearTicketCache();
    return {
      ...remote,
      valid: false,
      settingsPatch: {
        licenseActivatedOnline: false,
        licenseTicketExpireAt: undefined,
        licenseExpireAt: undefined,
        licenseTimeUnlimited: false,
        licensePlanLabel: "",
        licenseDeviceCount: undefined,
        licenseMaxDevices: undefined,
      },
    };
  } catch (error) {
    await clearTicketCache();
    throw error;
  }
}

function getFingerprintInfo() {
  return {
    fingerprint: getDeviceFingerprint(),
    deviceName: getDeviceName(),
    cachePath: cachePath(),
    publicKeyConfigured: Boolean(EMBEDDED_PUBLIC_KEY_B64URL),
  };
}

function readCachedSummary() {
  const cache = readCache();
  return {
    cache,
    settingsPatch: settingsSummaryFromCache(cache),
    fingerprint: getDeviceFingerprint(),
  };
}

module.exports = {
  APP_KEY_STABLE,
  APP_KEY_BETA,
  PUBLIC_UPDATE_BASE,
  LICENSE_SCOPES,
  EMBEDDED_PUBLIC_KEY_B64URL,
  getDeviceFingerprint,
  getDeviceName,
  getFingerprintInfo,
  readCachedSummary,
  verifyLicenseTicket,
  status,
  redeem,
  unbind,
  clearTicketCache,
};
