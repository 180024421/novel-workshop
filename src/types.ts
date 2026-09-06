import type { ProviderConfig } from "./lib/providerPresets";

export type AppSettings = {
  defaultModel: string;
  stream: boolean;
  /** 总纲 / 扩展设定 / 抽人物 */
  routeOutline: string;
  /** 正文 / 细纲拆解 / 批量写 */
  routeChapter: string;
  /** 连贯检查 / 细纲对照 / 规范化 */
  routeCheck: string;
  /** 是否启用多阶段写作流水线，默认开启 */
  writePipelineEnabled?: boolean;
  /** 是否启用字数门禁，默认开启 */
  writePipelineWordGate?: boolean;
  /** 是否启用细纲自检，默认开启 */
  writePipelineBeatsCheck?: boolean;
  /** 是否启用正文润色，默认开启 */
  writePipelinePolish?: boolean;
  /** 字数门禁最低达标比例，默认 0.9 */
  writePipelineMinRatio?: number;
  /** 字数门禁最高比例，默认 1.15 */
  writePipelineMaxRatio?: number;
  /** 默认单章目标字数，默认 2500 */
  defaultChapterWords?: number;
  /** 可选：自定义 jiaoben 更新根地址；空则用官方默认 */
  updateApiBase?: string;
  /** 启动时静默检查更新 */
  checkUpdateOnLaunch?: boolean;
  /** 启动时自动打开上次书稿并续写 */
  autoResume?: boolean;
  /** 正文编辑器字号（px） */
  editorFontSize?: number;
  /** 专注模式：隐藏侧栏 */
  focusMode?: boolean;
  /** 每日写作目标字数 */
  dailyWordGoal?: number;
  /** 编辑器主题（成套配色 id） */
  editorTheme?: string;
  /** 正文行距 */
  editorLineHeight?: number;
  /** 自定义编辑区背景色（空则跟主题） */
  editorBgColor?: string;
  /** 自定义编辑区文字色（空则跟主题） */
  editorFgColor?: string;
  /** 侧栏背景色 */
  sidebarBgColor?: string;
  /** 侧栏主文字色 */
  sidebarFgColor?: string;
  /** 侧栏次要文字（章目录等） */
  sidebarMutedColor?: string;
  /** 侧栏字号（px） */
  sidebarFontSize?: number;
  /** 自定义快捷键 */
  hotkeys?: {
    save?: string;
    generate?: string;
    next?: string;
    prev?: string;
    focus?: string;
    search?: string;
    bookSearch?: string;
  };
  /** 定时本地 zip 备份间隔（小时）；0=关闭 */
  autoBackupHours?: number;
  /** 上次自动备份时间戳（ms） */
  lastAutoBackupAt?: number;
  /** 首次启动时间戳（ms），用于本地试用计时 */
  firstLaunchAt?: number;
  /** 本地授权码（不联网校验） */
  licenseKey?: string;
  /** 服务端授权到期 ms；null=不限时 */
  licenseExpireAt?: number | null;
  /** 本地缓存 ticket 过期 ms */
  licenseTicketExpireAt?: number;
  licenseTimeUnlimited?: boolean;
  /** 是否曾成功在线激活 */
  licenseActivatedOnline?: boolean;
  licenseLastOnlineAt?: number;
  /** 离线宽限毫秒，默认 72h */
  licenseGraceMs?: number;
  licensePlanLabel?: string;
  licenseDeviceCount?: number;
  licenseMaxDevices?: number;
  deviceFingerprint?: string;
  /** stable | beta → app-update appKey */
  updateChannel?: "stable" | "beta";
  /** 购买链接（商城） */
  shopUrl?: string;
  /** 闲鱼购买提示文案 */
  xianyuTip?: string;
};

export type LicenseBridgeStatus = {
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
  fromCache?: boolean;
  settingsPatch?: Partial<AppSettings>;
};

export type AppMetaBridge = {
  announcements?: Array<{
    id: string;
    title: string;
    body: string;
    level?: string;
    force?: boolean;
    minVersionCode?: number;
    maxVersionCode?: number;
    expireAt?: string | null;
  }>;
  maintenance?: { enabled: boolean; message?: string };
  shopUrl?: string;
  xianyuTip?: string;
  fetchedAt?: number;
  fromCache?: boolean;
  ok?: boolean;
  status?: number;
  message?: string;
};


export type ProjectMeta = {
  id: string;
  title: string;
  genre: string;
  createdAt: string;
  updatedAt: string;
  stage: { bibleLocked: boolean; outlineLocked: boolean };
  defaultModel: string;
};

export type RecentItem = { path: string; title: string; openedAt: number };

export type OpenedProject = { root: string; project: ProjectMeta };

export type CharacterCard = {
  id: string;
  name: string;
  role: string;
  voice: string;
  traits: string;
  relationships: string;
  taboo: string;
  arc: string;
};

export type KbChunk = {
  id: string;
  source: string;
  text: string;
  tags: string[];
};

declare global {
  interface Window {
    moshu?: {
      getSettings: () => Promise<AppSettings>;
      setSettings: (s: AppSettings) => Promise<AppSettings>;
      getProviders: () => Promise<ProviderConfig[] | null>;
      setProviders: (list: ProviderConfig[]) => Promise<ProviderConfig[]>;
      listRecent: () => Promise<RecentItem[]>;
      removeRecent: (path: string) => Promise<RecentItem[]>;
      renameRecent: (p: { path: string; title: string }) => Promise<RecentItem[]>;
      pickFolder: () => Promise<string | null>;
      createProject: (p: {
        folder: string;
        title: string;
        genre: string;
      }) => Promise<OpenedProject>;
      createProjectDefault: (p: {
        title: string;
        genre: string;
      }) => Promise<OpenedProject>;
      openProject: (folder: string) => Promise<OpenedProject>;
      readText: (p: string) => Promise<string>;
      writeText: (p: string, c: string) => Promise<boolean>;
      readJson: <T>(p: string, fb?: T) => Promise<T>;
      writeJson: (p: string, d: unknown) => Promise<boolean>;
      deletePath: (p: string) => Promise<boolean>;
      listDir: (p: string) => Promise<{ name: string; path: string }[]>;
      joinPath: (...parts: string[]) => Promise<string>;
      openExternal: (url: string) => Promise<void>;
      pickFiles: (opts?: {
        title?: string;
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<string[]>;
      saveFile?: (opts: {
        defaultPath?: string;
        content: string;
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<string | null>;
      platform: () => Promise<{ platform: string; arch: string }>;
      chat: (payload: {
        requestId?: string;
        baseUrl: string;
        apiKey: string;
        model: string;
        messages: { role: string; content: string }[];
        stream?: boolean;
        temperature?: number;
        max_tokens?: number;
      }) => Promise<{ content: string; providerModel: string }>;
      abortChat?: (requestId: string) => Promise<boolean>;
      onChatDelta: (cb: (text: string) => void) => () => void;
      listPacks?: () => Promise<string[]>;
      pickDirectory?: () => Promise<string | null>;
      checkForUpdates?: () => Promise<{
        ok: boolean;
        message: string;
        hasUpdate?: boolean;
        remote?: unknown;
      }>;
      probeUpdate?: () => Promise<{
        hasUpdate: boolean;
        hint: string;
        ok?: boolean;
        remote?: unknown;
      }>;
      downloadUpdate?: () => Promise<{
        state: string;
        label: string;
        filePath: string;
        error: string;
        percent: number;
      }>;
      openInstaller?: (filePath?: string) => Promise<{ ok: boolean; message: string }>;
      cancelUpdateDownload?: () => Promise<unknown>;
      getDataPaths?: () => Promise<{
        userData: string;
        documentsProjects: string;
        versionName: string;
        versionCode: number;
        note: string;
      }>;
      getUpdateStatus?: () => Promise<unknown>;
      onUpdateProbe?: (cb: (data: { hasUpdate: boolean; hint: string }) => void) => () => void;
      onUpdateDownload?: (cb: (data: {
        state: string;
        label: string;
        filePath: string;
        percent: number;
        error: string;
      }) => void) => () => void;
      getSession?: () => Promise<{
        root: string;
        title: string;
        chapterId: string;
        chapterTitle: string;
        route: string;
        updatedAt: number;
      } | null>;
      setSession?: (
        s: {
          root: string;
          title: string;
          chapterId: string;
          chapterTitle: string;
          route: string;
          updatedAt: number;
        } | null
      ) => Promise<unknown>;
      getUsage?: () => Promise<{ days: Record<string, { words: number; costCny: number }> }>;
      addUsage?: (delta: { words?: number; costCny?: number }) => Promise<{
        words: number;
        costCny: number;
      }>;
      zipProjectBackup?: (payload: {
        root: string;
        title: string;
      }) => Promise<{ ok: boolean; message: string; filePath?: string; fileCount?: number }>;
      exportVolumeZip?: (payload: {
        root: string;
        title: string;
        format?: string;
        chaptersPerVolume?: number;
      }) => Promise<{ ok: boolean; message: string; filePath?: string; volumes?: number }>;
      showItemInFolder?: (filePath: string) => Promise<{ ok: boolean }>;
      openPath?: (target: string) => Promise<{ ok: boolean; message?: string }>;
      readImportText?: (filePath: string) => Promise<string>;
      minimizeToTray?: () => Promise<{ ok: boolean }>;
      showMainWindow?: () => Promise<{ ok: boolean }>;
      notify?: (payload: { title: string; body: string }) => Promise<{ ok: boolean }>;
      getDeviceFingerprint?: () => Promise<{
        fingerprint: string;
        deviceName: string;
        cachePath: string;
        publicKeyConfigured: boolean;
      }>;
      licenseStatus?: () => Promise<LicenseBridgeStatus>;
      licenseRedeem?: (cardCode: string) => Promise<LicenseBridgeStatus>;
      licenseUnbind?: () => Promise<LicenseBridgeStatus>;
      licenseCached?: () => Promise<{ cache: unknown; settingsPatch: Partial<AppSettings>; fingerprint: string }>;
      fetchAppMeta?: () => Promise<AppMetaBridge>;
      getCachedAppMeta?: () => Promise<AppMetaBridge>;
    };
  }
}

export {};
