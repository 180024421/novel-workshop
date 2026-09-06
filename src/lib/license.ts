import type { AppSettings } from "../types";

/** 试用天数：自 firstLaunchAt 起算 */
export const TRIAL_DAYS = 14;

/** 演示授权码（仅开发/显式 env 可用） */
export const DEMO_LICENSE_KEY = "MOSHU-DEMO-FULL-ACCESS";

/** 离线宽限默认：ticket 过期后再给 72 小时（仅曾成功在线激活过） */
export const DEFAULT_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type LicensePhase = "trial" | "licensed" | "grace" | "expired";

export type LicenseEvalInput = {
  now?: number;
  firstLaunchAt?: number;
  /** 服务端授权到期（ms）；null/undefined + timeUnlimited 表示不限时 */
  licenseExpireAt?: number | null;
  timeUnlimited?: boolean;
  /** 本地缓存的 ticket 过期时间（ms） */
  ticketExpireAt?: number | null;
  /** 是否曾成功在线激活并拿到有效 ticket */
  activatedOnline?: boolean;
  /** 上次成功在线校验本地时间（ms），用于宽限与弱防回拨 */
  lastOnlineAt?: number | null;
  graceMs?: number;
  /** 仅开发/显式开关时允许本地演示码 */
  allowDemoKey?: boolean;
  /** 用户输入的卡密展示字段（不再用于本地永久解锁） */
  licenseKey?: string | null;
  trialDays?: number;
};

export type LicenseStatus = {
  ok: boolean;
  reason: string;
  phase: LicensePhase;
  /** 试用剩余天数（向上取整到天） */
  daysLeft?: number;
  /** 是否持有正式授权（含宽限期内） */
  licensed?: boolean;
  /** 是否处于离线宽限 */
  grace?: boolean;
  expireAt?: number | null;
  ticketExpireAt?: number | null;
};

export function isDemoLicenseAllowed(explicit?: boolean): boolean {
  if (explicit === true) return true;
  try {
    // Vite / 浏览器
    const meta = import.meta as ImportMeta & { env?: Record<string, string> };
    if (meta.env?.DEV) return true;
    if (meta.env?.VITE_ALLOW_DEMO_LICENSE === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** 旧版本地正则永久码已废弃；保留函数仅用于提示文案，始终返回 false（演示码除外） */
export function isValidLicenseKey(
  key: string | undefined | null,
  allowDemo = isDemoLicenseAllowed()
): boolean {
  const k = String(key || "").trim();
  if (!k) return false;
  if (allowDemo && k.toUpperCase() === DEMO_LICENSE_KEY) return true;
  return false;
}

function trialDaysLeft(firstLaunchAt: number, now: number, trialDays: number): number {
  const elapsedMs = Math.max(0, now - firstLaunchAt);
  const daysUsed = Math.floor(elapsedMs / MS_PER_DAY);
  return trialDays - daysUsed;
}

/**
 * 纯状态机：trial / licensed / grace / expired。
 * - 正式授权：timeUnlimited 或 licenseExpireAt > now，且 ticket 未过期；或 ticket 刚过期但在 grace 内且曾在线激活
 * - 试用：无正式授权时看 firstLaunchAt
 * - 演示码：仅 allowDemoKey 时视为 licensed
 */
export function evaluateLicenseState(input: LicenseEvalInput): LicenseStatus {
  const now = Number(input.now) || Date.now();
  const trialDays = Math.max(1, Number(input.trialDays) || TRIAL_DAYS);
  const graceMs = Math.max(0, Number(input.graceMs ?? DEFAULT_OFFLINE_GRACE_MS));
  const allowDemo = Boolean(input.allowDemoKey);
  const key = String(input.licenseKey || "").trim();

  if (allowDemo && key.toUpperCase() === DEMO_LICENSE_KEY) {
    return {
      ok: true,
      reason: "演示授权已生效（仅开发环境）",
      phase: "licensed",
      licensed: true,
      grace: false,
      expireAt: null,
      ticketExpireAt: null,
    };
  }

  const timeUnlimited = Boolean(input.timeUnlimited);
  const licenseExpireAt =
    input.licenseExpireAt == null || input.licenseExpireAt === undefined
      ? null
      : Number(input.licenseExpireAt);
  const ticketExpireAt =
    input.ticketExpireAt == null || input.ticketExpireAt === undefined
      ? null
      : Number(input.ticketExpireAt);
  const activatedOnline = Boolean(input.activatedOnline);
  const lastOnlineAt =
    input.lastOnlineAt == null || input.lastOnlineAt === undefined
      ? null
      : Number(input.lastOnlineAt);

  const hasLicenseEntitlement =
    activatedOnline &&
    (timeUnlimited ||
      (licenseExpireAt != null && Number.isFinite(licenseExpireAt) && licenseExpireAt > now));

  const ticketFresh =
    ticketExpireAt != null && Number.isFinite(ticketExpireAt) && ticketExpireAt > now;

  if (hasLicenseEntitlement && ticketFresh) {
    return {
      ok: true,
      reason: timeUnlimited
        ? "授权有效（不限时）"
        : `授权有效，到期 ${new Date(licenseExpireAt as number).toLocaleString()}`,
      phase: "licensed",
      licensed: true,
      grace: false,
      expireAt: timeUnlimited ? null : licenseExpireAt,
      ticketExpireAt,
    };
  }

  // ticket 过期后的离线宽限：仅曾成功在线激活，且授权本身仍有效（或永久）
  if (hasLicenseEntitlement && activatedOnline && ticketExpireAt != null) {
    const graceEnd = ticketExpireAt + graceMs;
    if (now <= graceEnd) {
      const hoursLeft = Math.max(1, Math.ceil((graceEnd - now) / (60 * 60 * 1000)));
      return {
        ok: true,
        reason: `离线宽限中（约剩 ${hoursLeft} 小时），请尽快联网刷新授权`,
        phase: "grace",
        licensed: true,
        grace: true,
        expireAt: timeUnlimited ? null : licenseExpireAt,
        ticketExpireAt,
      };
    }
  }

  // 弱防回拨：若 lastOnlineAt 明显晚于 now，且曾激活，则要求重新联网（不放行宽限）
  if (
    activatedOnline &&
    lastOnlineAt != null &&
    Number.isFinite(lastOnlineAt) &&
    now + 60_000 < lastOnlineAt - 2 * 60 * 60 * 1000
  ) {
    return {
      ok: false,
      reason: "检测到系统时间异常，请校准时间后联网刷新授权",
      phase: "expired",
      licensed: false,
      grace: false,
      expireAt: licenseExpireAt,
      ticketExpireAt,
    };
  }

  const start = Number(input.firstLaunchAt) || 0;
  if (!start) {
    return {
      ok: true,
      reason: "试用尚未开始（将于首次启动计时）",
      phase: "trial",
      daysLeft: trialDays,
      licensed: false,
      grace: false,
    };
  }

  const daysLeft = trialDaysLeft(start, now, trialDays);
  if (daysLeft > 0) {
    return {
      ok: true,
      reason: `试用剩余约 ${daysLeft} 天`,
      phase: "trial",
      daysLeft,
      licensed: false,
      grace: false,
    };
  }

  const daysOver = Math.abs(Math.min(0, daysLeft));
  return {
    ok: false,
    reason:
      daysOver === 0
        ? "试用已到期，请兑换卡密激活授权（可继续打开书稿）"
        : `试用已过期 ${daysOver} 天，请兑换卡密后继续生成`,
    phase: "expired",
    daysLeft: 0,
    licensed: false,
    grace: false,
    expireAt: licenseExpireAt,
    ticketExpireAt,
  };
}

/**
 * 从设置字段评估许可（同步）。
 * 正式授权依赖 electron 写入的缓存摘要字段；原始 ticket 仅存 userData。
 */
export function checkLicense(
  settings: Pick<
    AppSettings,
    | "firstLaunchAt"
    | "licenseKey"
    | "licenseExpireAt"
    | "licenseTicketExpireAt"
    | "licenseTimeUnlimited"
    | "licenseActivatedOnline"
    | "licenseLastOnlineAt"
    | "licenseGraceMs"
  >
): LicenseStatus {
  return evaluateLicenseState({
    firstLaunchAt: settings.firstLaunchAt,
    licenseKey: settings.licenseKey,
    licenseExpireAt: settings.licenseExpireAt ?? null,
    ticketExpireAt: settings.licenseTicketExpireAt ?? null,
    timeUnlimited: Boolean(settings.licenseTimeUnlimited),
    activatedOnline: Boolean(settings.licenseActivatedOnline),
    lastOnlineAt: settings.licenseLastOnlineAt ?? null,
    graceMs: settings.licenseGraceMs,
    allowDemoKey: isDemoLicenseAllowed(),
  });
}

/** @deprecated 旧宽限（试用过期后 3 天提示）；新逻辑请看 phase==='grace' */
export function isLicenseGracePeriod(
  settings: Pick<AppSettings, "firstLaunchAt" | "licenseKey"> &
    Partial<
      Pick<
        AppSettings,
        | "licenseExpireAt"
        | "licenseTicketExpireAt"
        | "licenseTimeUnlimited"
        | "licenseActivatedOnline"
        | "licenseLastOnlineAt"
        | "licenseGraceMs"
      >
    >
): boolean {
  return checkLicense(settings as AppSettings).phase === "grace";
}

export type LicenseApiStatus = {
  valid: boolean;
  status?: string;
  expireAt?: string | null;
  timeUnlimited?: boolean;
  planLabel?: string;
  ticket?: string;
  ticketExpireAt?: string | number | null;
  message?: string;
  maxDevices?: number;
  deviceCount?: number;
  contractStatus?: string | null;
  fromCache?: boolean;
};

export function settingsPatchFromApiStatus(
  status: LicenseApiStatus,
  extras?: { cardCode?: string }
): Partial<AppSettings> {
  const ticketExpireAt =
    status.ticketExpireAt == null ? undefined : Number(status.ticketExpireAt);
  let licenseExpireAt: number | null | undefined;
  if (status.timeUnlimited) licenseExpireAt = null;
  else if (status.expireAt) {
    const parsed = Date.parse(String(status.expireAt));
    licenseExpireAt = Number.isFinite(parsed) ? parsed : undefined;
  }

  if (!status.valid) {
    return {
      licenseActivatedOnline: false,
      licenseTicketExpireAt: undefined,
      licenseExpireAt: undefined,
      licenseTimeUnlimited: false,
      licensePlanLabel: "",
      licenseDeviceCount: undefined,
      licenseMaxDevices: undefined,
    };
  }

  return {
    licenseKey: extras?.cardCode ? String(extras.cardCode).trim() : undefined,
    licenseActivatedOnline: true,
    licenseLastOnlineAt: Date.now(),
    licenseTicketExpireAt: Number.isFinite(ticketExpireAt as number)
      ? (ticketExpireAt as number)
      : undefined,
    licenseExpireAt: licenseExpireAt === undefined ? undefined : licenseExpireAt,
    licenseTimeUnlimited: Boolean(status.timeUnlimited),
    licensePlanLabel: status.planLabel || "",
    licenseDeviceCount: status.deviceCount,
    licenseMaxDevices: status.maxDevices,
  };
}

export const APP_LICENSE_KEY = "dashuai-moshu";
export const APP_LICENSE_KEY_BETA = "dashuai-moshu-beta";

export function resolveLicenseAppKey(channel?: string): string {
  return String(channel || "stable").toLowerCase() === "beta"
    ? APP_LICENSE_KEY_BETA
    : APP_LICENSE_KEY;
}
