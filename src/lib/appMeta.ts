/** 远程公告 / 维护模式（GET /api/app-meta/{appKey}） */

export type AnnouncementLevel = "info" | "warn" | "critical";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  level?: AnnouncementLevel;
  force?: boolean;
  minVersionCode?: number;
  maxVersionCode?: number;
  expireAt?: string | null;
};

export type MaintenanceInfo = {
  enabled: boolean;
  message?: string;
};

export type AppMetaPayload = {
  announcements?: Announcement[];
  maintenance?: MaintenanceInfo;
  shopUrl?: string;
  xianyuTip?: string;
  fetchedAt?: number;
};

export type AnnouncementFilterInput = {
  announcements: Announcement[];
  versionCode: number;
  now?: number;
  dismissedIds?: Iterable<string>;
};

/**
 * 按 versionCode / 过期时间 / 已关闭 id 过滤公告。
 * force/critical 即使在 dismissed 中也会保留（由 UI 再决定是否强制弹出）。
 */
export function filterAnnouncements(input: AnnouncementFilterInput): Announcement[] {
  const now = Number(input.now) || Date.now();
  const dismissed = new Set(
    Array.from(input.dismissedIds || []).map((id) => String(id || "").trim()).filter(Boolean)
  );
  const versionCode = Number(input.versionCode) || 0;
  const list = Array.isArray(input.announcements) ? input.announcements : [];

  return list.filter((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const id = String(raw.id || "").trim();
    if (!id) return false;
    const force = Boolean(raw.force) || String(raw.level || "") === "critical";
    if (!force && dismissed.has(id)) return false;

    const minV = Number(raw.minVersionCode ?? 0);
    const maxV = Number(raw.maxVersionCode ?? 999999999);
    if (versionCode < minV || versionCode > maxV) return false;

    if (raw.expireAt) {
      const exp = Date.parse(String(raw.expireAt));
      if (Number.isFinite(exp) && exp <= now) return false;
    }
    return true;
  });
}

export function pickForceAnnouncements(list: Announcement[]): Announcement[] {
  return list.filter((a) => Boolean(a.force) || a.level === "critical");
}

export function normalizeAppMeta(raw: unknown): AppMetaPayload {
  if (!raw || typeof raw !== "object") return { announcements: [], maintenance: { enabled: false } };
  const root = raw as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const announcementsRaw = Array.isArray(data.announcements) ? data.announcements : [];
  const announcements: Announcement[] = announcementsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const a = item as Record<string, unknown>;
      const id = String(a.id || "").trim();
      if (!id) return null;
      return {
        id,
        title: String(a.title || ""),
        body: String(a.body || a.content || ""),
        level: (String(a.level || "info") as AnnouncementLevel) || "info",
        force: Boolean(a.force),
        minVersionCode: Number(a.minVersionCode ?? 0),
        maxVersionCode: Number(a.maxVersionCode ?? 999999999),
        expireAt: a.expireAt == null ? null : String(a.expireAt),
      } satisfies Announcement;
    })
    .filter(Boolean) as Announcement[];

  const m = data.maintenance && typeof data.maintenance === "object"
    ? (data.maintenance as Record<string, unknown>)
    : {};
  return {
    announcements,
    maintenance: {
      enabled: Boolean(m.enabled),
      message: String(m.message || ""),
    },
    shopUrl: data.shopUrl != null ? String(data.shopUrl) : undefined,
    xianyuTip: data.xianyuTip != null ? String(data.xianyuTip) : undefined,
    fetchedAt: Date.now(),
  };
}

export const APP_META_CACHE_KEY = "moshu.appMeta";
export const APP_META_DISMISSED_KEY = "moshu.announcementDismissed";

export function loadDismissedIds(): string[] {
  try {
    const raw = localStorage.getItem(APP_META_DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function saveDismissedIds(ids: string[]): void {
  try {
    localStorage.setItem(APP_META_DISMISSED_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* ignore */
  }
}

export function dismissAnnouncement(id: string): string[] {
  const next = [...loadDismissedIds(), String(id)];
  saveDismissedIds(next);
  return next;
}
