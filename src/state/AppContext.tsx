import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { providersReady } from "../lib/gateway";
import { defaultProviders, type ProviderConfig } from "../lib/providerPresets";
import { loadSession, saveSession, type WritingSession } from "../lib/session";
import { applyEditorAppearance, isEditorThemeId } from "../lib/editorAppearance";
import { neighborChapter } from "../lib/chapterNav";
import { loadProjectVolumes } from "../lib/volumes";
import type { AppSettings, OpenedProject, RecentItem } from "../types";

type Ctx = {
  settings: AppSettings;
  setSettings: (s: AppSettings) => Promise<void>;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  providers: ProviderConfig[];
  setProviders: (list: ProviderConfig[]) => Promise<void>;
  recent: RecentItem[];
  refreshRecent: () => Promise<void>;
  project: OpenedProject | null;
  setProject: (p: OpenedProject | null) => void;
  join: (...parts: string[]) => Promise<string>;
  isElectron: boolean;
  llmReady: boolean;
  chapterId: string;
  setChapterId: (id: string) => void;
  chapterTitle: string;
  setChapterTitle: (t: string) => void;
  volumeId: string;
  setVolumeId: (id: string) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  bootstrapped: boolean;
  persistSession: (route?: string) => Promise<void>;
};

const AppCtx = createContext<Ctx | null>(null);

function normalizeSettings(s: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    defaultModel: s?.defaultModel || "小说",
    stream: s?.stream !== false,
    routeOutline: s?.routeOutline || "复杂",
    routeChapter: s?.routeChapter || "小说",
    routeCheck: s?.routeCheck || "复杂",
    writePipelineEnabled: s?.writePipelineEnabled !== false,
    writePreset: s?.writePreset === "fast" ? "fast" : "quality",
    writePipelineSkipBeatsCheck: Boolean(s?.writePipelineSkipBeatsCheck),
    writePipelineSkipPolish: Boolean(s?.writePipelineSkipPolish),
    writePipelineWordGate: s?.writePipelineWordGate !== false,
    writePipelineBeatsCheck: s?.writePipelineBeatsCheck !== false,
    writePipelinePolish: s?.writePipelinePolish !== false,
    writePipelineMinRatio: Number(s?.writePipelineMinRatio) || 0.9,
    writePipelineMaxRatio: Number(s?.writePipelineMaxRatio) || 1.15,
    defaultChapterWords: Math.max(800, Math.round(Number(s?.defaultChapterWords) || 2500)),
    updateApiBase: s?.updateApiBase || "",
    checkUpdateOnLaunch: s?.checkUpdateOnLaunch !== false,
    autoResume: s?.autoResume !== false,
    editorFontSize: Math.min(36, Math.max(12, Number(s?.editorFontSize) || 16)),
    focusMode: Boolean(s?.focusMode),
    dailyWordGoal: Math.max(0, Math.round(Number(s?.dailyWordGoal) || 2000)),
    editorTheme: isEditorThemeId(s?.editorTheme) ? s.editorTheme : "ink",
    editorLineHeight: Math.min(2.4, Math.max(1.4, Number(s?.editorLineHeight) || 1.75)),
    editorBgColor: typeof s?.editorBgColor === "string" ? s.editorBgColor : "",
    editorFgColor: typeof s?.editorFgColor === "string" ? s.editorFgColor : "",
    sidebarBgColor: typeof s?.sidebarBgColor === "string" ? s.sidebarBgColor : "",
    sidebarFgColor: typeof s?.sidebarFgColor === "string" ? s.sidebarFgColor : "",
    sidebarMutedColor: typeof s?.sidebarMutedColor === "string" ? s.sidebarMutedColor : "",
    sidebarFontSize: Math.min(18, Math.max(11, Number(s?.sidebarFontSize) || 13)),
    hotkeys: {
      save: s?.hotkeys?.save || "Control+S",
      generate: s?.hotkeys?.generate || "Control+Enter",
      next: s?.hotkeys?.next || "Control+Shift+N",
      focus: s?.hotkeys?.focus || "F11",
      search: s?.hotkeys?.search || "Control+F",
      bookSearch: s?.hotkeys?.bookSearch || "Control+Shift+F",
      prev: s?.hotkeys?.prev || "Control+Shift+P",
    },
    autoBackupHours: Math.max(0, Math.min(168, Number(s?.autoBackupHours) || 0)),
    lastAutoBackupAt: Math.max(0, Math.round(Number(s?.lastAutoBackupAt) || 0)),
    firstLaunchAt: Math.max(0, Math.round(Number(s?.firstLaunchAt) || 0)) || undefined,
    licenseKey: typeof s?.licenseKey === "string" ? s.licenseKey.trim() : "",
    licenseExpireAt:
      s?.licenseExpireAt === null
        ? null
        : s?.licenseExpireAt != null && Number.isFinite(Number(s.licenseExpireAt))
          ? Number(s.licenseExpireAt)
          : undefined,
    licenseTicketExpireAt:
      s?.licenseTicketExpireAt != null && Number.isFinite(Number(s.licenseTicketExpireAt))
        ? Number(s.licenseTicketExpireAt)
        : undefined,
    licenseTimeUnlimited: Boolean(s?.licenseTimeUnlimited),
    licenseActivatedOnline: Boolean(s?.licenseActivatedOnline),
    licenseLastOnlineAt:
      s?.licenseLastOnlineAt != null && Number.isFinite(Number(s.licenseLastOnlineAt))
        ? Number(s.licenseLastOnlineAt)
        : undefined,
    licenseGraceMs:
      s?.licenseGraceMs != null && Number.isFinite(Number(s.licenseGraceMs))
        ? Number(s.licenseGraceMs)
        : undefined,
    licensePlanLabel: typeof s?.licensePlanLabel === "string" ? s.licensePlanLabel : "",
    licenseDeviceCount:
      s?.licenseDeviceCount != null && Number.isFinite(Number(s.licenseDeviceCount))
        ? Number(s.licenseDeviceCount)
        : undefined,
    licenseMaxDevices:
      s?.licenseMaxDevices != null && Number.isFinite(Number(s.licenseMaxDevices))
        ? Number(s.licenseMaxDevices)
        : undefined,
    deviceFingerprint: typeof s?.deviceFingerprint === "string" ? s.deviceFingerprint : "",
    updateChannel: s?.updateChannel === "beta" ? "beta" : "stable",
    shopUrl: typeof s?.shopUrl === "string" ? s.shopUrl : "",
    xianyuTip: typeof s?.xianyuTip === "string" ? s.xianyuTip : "",
    editorEngine: s?.editorEngine === "textarea" ? "textarea" : "codemirror",
    kbAutoIndexChapters: s?.kbAutoIndexChapters !== false,
    kbEmbeddingEnabled: Boolean(s?.kbEmbeddingEnabled),
    kbEmbeddingModel:
      typeof s?.kbEmbeddingModel === "string" && s.kbEmbeddingModel.trim()
        ? s.kbEmbeddingModel.trim()
        : "text-embedding-3-small",
    confirmCostBeforeWrite: s?.confirmCostBeforeWrite !== false,
    summaryInjectCount: Math.min(12, Math.max(0, Math.round(Number(s?.summaryInjectCount) || 5))),
    autoSummarizeChapter: s?.autoSummarizeChapter !== false,
  };
}

const webFallbackSettings: AppSettings = normalizeSettings({});

export function AppProvider({ children }: { children: ReactNode }) {
  const isElectron = Boolean(window.moshu);
  const [settings, setSettingsState] = useState<AppSettings>(webFallbackSettings);
  const [providers, setProvidersState] = useState<ProviderConfig[]>(defaultProviders());
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [project, setProjectState] = useState<OpenedProject | null>(null);
  const [chapterId, setChapterId] = useState("第1章");
  const [chapterTitle, setChapterTitle] = useState("开端");
  const [volumeId, setVolumeId] = useState("第1卷");
  const [bootstrapped, setBootstrapped] = useState(false);

  const refreshRecent = useCallback(async () => {
    if (!window.moshu) return;
    setRecent(await window.moshu.listRecent());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (window.moshu) {
          const s = await window.moshu.getSettings();
          let next = normalizeSettings(s);
          if (!next.firstLaunchAt) {
            next = { ...next, firstLaunchAt: Date.now() };
            await window.moshu.setSettings(next);
          }
          setSettingsState(next);
          const saved = await window.moshu.getProviders();
          if (saved?.length) {
            const byId = new Map(saved.map((p) => [p.id, p]));
            const merged = defaultProviders().map((p) => {
              const old = byId.get(p.id);
              return old
                ? {
                    ...p,
                    apiKey: old.apiKey,
                    enabled: old.enabled,
                    models: old.models?.length ? old.models : p.models,
                  }
                : p;
            });
            for (const p of saved) {
              if (!merged.find((x) => x.id === p.id)) merged.push(p);
            }
            setProvidersState(merged);
          }
          await refreshRecent();
        } else {
          const raw = localStorage.getItem("moshu.settings");
          let next = normalizeSettings(raw ? JSON.parse(raw) : {});
          if (!next.firstLaunchAt) {
            next = { ...next, firstLaunchAt: Date.now() };
            localStorage.setItem("moshu.settings", JSON.stringify(next));
          }
          setSettingsState(next);
          const pr = localStorage.getItem("moshu.providers");
          if (pr) setProvidersState(JSON.parse(pr));
        }
      } finally {
        setBootstrapped(true);
      }
    })();
  }, [refreshRecent]);

  const setSettings = useCallback(async (s: AppSettings) => {
    const next = normalizeSettings(s);
    setSettingsState(next);
    applyEditorAppearance(next);
    if (window.moshu) await window.moshu.setSettings(next);
    else localStorage.setItem("moshu.settings", JSON.stringify(next));
  }, []);

  useEffect(() => {
    applyEditorAppearance(settings);
  }, [settings]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const patchSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      await setSettings({ ...settingsRef.current, ...patch });
    },
    [setSettings]
  );

  const setProviders = useCallback(async (list: ProviderConfig[]) => {
    setProvidersState(list);
    if (window.moshu) await window.moshu.setProviders(list);
    else localStorage.setItem("moshu.providers", JSON.stringify(list));
  }, []);

  const join = useCallback(async (...parts: string[]) => {
    if (window.moshu) return window.moshu.joinPath(...parts);
    return parts.join("/");
  }, []);

  const persistSession = useCallback(
    async (route = "/app/chapter") => {
      if (!project) return;
      const sess: WritingSession = {
        root: project.root,
        title: project.project.title,
        chapterId,
        chapterTitle,
        volumeId,
        route,
        updatedAt: Date.now(),
      };
      await saveSession(sess);
    },
    [project, chapterId, chapterTitle, volumeId]
  );

  const setProject = useCallback((p: OpenedProject | null) => {
    setProjectState(p);
    if (!p) void saveSession(null);
  }, []);

  useEffect(() => {
    if (!project) return;
    const t = window.setTimeout(() => {
      void persistSession();
    }, 400);
    return () => window.clearTimeout(t);
  }, [project, chapterId, chapterTitle, volumeId, persistSession]);

  const goNeighbor = useCallback(
    async (dir: -1 | 1) => {
      const fallback = () => {
        const m = chapterId.match(/第(\d+)章/);
        const n = m ? Number(m[1]) + dir : dir === 1 ? 2 : 1;
        if (n < 1) return;
        setChapterId(`第${n}章`);
        setChapterTitle("未命名");
      };
      if (!project || !window.moshu) {
        fallback();
        return;
      }
      try {
        const outline = await window.moshu.readText(
          await join(project.root, "outlines", "outline.md")
        );
        const volumes = await loadProjectVolumes({
          root: project.root,
          join,
          outline,
        });
        const list = volumes.flatMap((v) =>
          v.chapters.map((c) => ({ id: c.id, title: c.title }))
        );
        const hit = neighborChapter(list, chapterId, dir);
        if (!hit) return;
        setChapterId(hit.id);
        setChapterTitle(hit.title);
        const vol = volumes.find((v) => v.chapters.some((c) => c.id === hit.id));
        if (vol) setVolumeId(vol.id);
      } catch {
        fallback();
      }
    },
    [project, join, chapterId]
  );

  const nextChapter = useCallback(() => {
    void goNeighbor(1);
  }, [goNeighbor]);

  const prevChapter = useCallback(() => {
    void goNeighbor(-1);
  }, [goNeighbor]);

  const llmReady = providersReady(providers);

  const value = useMemo(
    () => ({
      settings,
      setSettings,
      patchSettings,
      providers,
      setProviders,
      recent,
      refreshRecent,
      project,
      setProject,
      join,
      isElectron,
      llmReady,
      chapterId,
      setChapterId,
      chapterTitle,
      setChapterTitle,
      volumeId,
      setVolumeId,
      nextChapter,
      prevChapter,
      bootstrapped,
      persistSession,
    }),
    [
      settings,
      setSettings,
      patchSettings,
      providers,
      setProviders,
      recent,
      refreshRecent,
      project,
      setProject,
      join,
      isElectron,
      llmReady,
      chapterId,
      chapterTitle,
      volumeId,
      nextChapter,
      prevChapter,
      bootstrapped,
      persistSession,
    ]
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}

/** 供首页续写：读取会话 */
export { loadSession };
