import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { exportBook } from "../lib/exportBook";
import {
  applyEditorAppearance,
  resolveSidebarColors,
  sidebarPresetPatch,
  type EditorThemeId,
} from "../lib/editorAppearance";
import { formatCny } from "../lib/costEstimate";
import { matchHotkey, normalizeHotkeyMap } from "../lib/hotkeys";
import { checkLicense } from "../lib/license";
import { AnnouncementBanner } from "../components/AnnouncementBanner";
import { buildProjectChecklist } from "../components/EmptyGuide";
import type { AppMetaPayload } from "../lib/appMeta";
import { loadJobQueue } from "../lib/jobQueue";
import { loadProjectProgress, type ProjectProgress } from "../lib/projectProgress";
import { loadSessionForRoot } from "../lib/session";
import { ensureVolumeBeatsFile } from "../lib/volumes";
import { getTodayUsage, goalProgress, type DayUsage } from "../lib/usageLedger";
import { useApp } from "../state/AppContext";

const mainLinks = [
  { to: "/app/idea", label: "设定", step: "1", key: "idea" as const },
  { to: "/app/outline", label: "总纲", step: "2", key: "outline" as const },
  { to: "/app/beats", label: "细纲", step: "3", key: "beats" as const },
  { to: "/app/chapter", label: "正文", step: "4", key: "chapter" as const },
];

const toolLinks = [
  { to: "/app/volumes", label: "卷章管理" },
  { to: "/app/batch", label: "批量写" },
  { to: "/app/search", label: "书内搜索" },
  { to: "/app/characters", label: "人物" },
  { to: "/app/entities", label: "实体设定" },
  { to: "/app/revise", label: "改稿队列" },
  { to: "/app/knowledge", label: "知识库" },
  { to: "/app/timeline", label: "时间线" },
  { to: "/app/stats", label: "写作统计" },
  { to: "/app/status", label: "进度导出" },
  { to: "/app/packs", label: "扩展包" },
  { to: "/app/settings", label: "设置" },
];
export function AppLayout() {
  const {
    project,
    setProject,
    llmReady,
    join,
    settings,
    patchSettings,
    chapterId,
    setChapterId,
    setChapterTitle,
    volumeId,
    setVolumeId,
    nextChapter,
    prevChapter,
    persistSession,
    recent,
    refreshRecent,
  } = useApp();
  const loc = useLocation();
  const nav = useNavigate();
  const [prog, setProg] = useState<ProjectProgress | null>(null);
  const [toast, setToast] = useState("");
  const [hasUpdate, setHasUpdate] = useState(false);
  const [today, setToday] = useState<DayUsage>({ words: 0, costCny: 0 });
  const [jobCount, setJobCount] = useState(0);
  const [chapterFilter, setChapterFilter] = useState("");
  const chapterListRef = useRef<HTMLDivElement>(null);
  const [toolsOpen, setToolsOpen] = useState(() => {
    try {
      return localStorage.getItem("moshu.toolsNavSeen") !== "1";
    } catch {
      return true;
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [sideAppearOpen, setSideAppearOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const settingsRefLastBackup = useRef(settings.lastAutoBackupAt ?? 0);
  settingsRefLastBackup.current = settings.lastAutoBackupAt ?? 0;

  const focusMode = Boolean(settings.focusMode);
  const goal = settings.dailyWordGoal || 2000;
  const pct = goalProgress(today.words, goal);
  const theme = settings.editorTheme || "ink";
  const keys = normalizeHotkeyMap(settings.hotkeys);
  const toolsActive = toolLinks.some((l) => loc.pathname.startsWith(l.to));
  const studioMode = ["/app/idea", "/app/outline", "/app/beats", "/app/chapter"].some((p) =>
    loc.pathname.startsWith(p)
  );
  const sideColors = resolveSidebarColors(settings);
  const license = useMemo(() => checkLicense(settings), [settings]);

  const projectChecklist = useMemo(() => {
    if (!prog || !project) return null;
    const ch1 =
      prog.chapterRows.find((r) => r.id === "第1章") || prog.chapterRows[0];
    const items = buildProjectChecklist({
      hasBible: Boolean(prog.hasBible || prog.hasSeed),
      hasOutline: Boolean(prog.hasOutline),
      hasBeats: prog.beatsDone > 0,
      hasChapter1: Boolean(ch1?.hasChapter),
    });
    if (items.every((i) => i.done)) return null;
    return items;
  }, [prog, project]);

  const [appMeta, setAppMeta] = useState<AppMetaPayload | null>(null);
  const [versionCode, setVersionCode] = useState(1);
  const [forceUpdate, setForceUpdate] = useState(false);
  const [forceHint, setForceHint] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const paths = await window.moshu?.getDataPaths?.();
        if (paths?.versionCode) setVersionCode(Number(paths.versionCode) || 1);
        const cached = await window.moshu?.getCachedAppMeta?.();
        if (cached) setAppMeta(cached as AppMetaPayload);
        const fresh = await window.moshu?.fetchAppMeta?.();
        if (fresh) setAppMeta(fresh as AppMetaPayload);
        const st = await window.moshu?.getUpdateStatus?.();
        const s = st as { forceUpdate?: boolean; probe?: { forceUpdate?: boolean; hint?: string } };
        const forced = Boolean(s?.forceUpdate || s?.probe?.forceUpdate);
        setForceUpdate(forced);
        setForceHint(s?.probe?.hint || "");
      } catch {
        /* ignore */
      }
    })();
    const off = window.moshu?.onUpdateProbe?.((d) => {
      const dd = d as { forceUpdate?: boolean; hint?: string };
      setForceUpdate(Boolean(dd.forceUpdate));
      setForceHint(dd.hint || "");
    });
    return () => off?.();
  }, []);


  const refresh = useCallback(async () => {
    if (!project) {
      setProg(null);
      setJobCount(0);
      return;
    }
    try {
      setProg(await loadProjectProgress(project.root, join));
      const q = await loadJobQueue(project.root, join);
      setJobCount((q.jobs || []).length);
    } catch {
      /* ignore */
    }
  }, [project, join]);

  useEffect(() => {
    void refresh();
  }, [refresh, loc.pathname, volumeId]);

  // 定时本地 zip 备份（小时级；0=关）
  useEffect(() => {
    const hours = settings.autoBackupHours ?? 0;
    if (!project || hours <= 0 || !window.moshu?.zipProjectBackup) return;

    const intervalMs = hours * 3600 * 1000;
    let busy = false;

    async function maybeBackup() {
      if (busy || !project || !window.moshu?.zipProjectBackup) return;
      const last = settingsRefLastBackup.current;
      if (Date.now() - last < intervalMs) return;
      busy = true;
      try {
        const r = await window.moshu.zipProjectBackup({
          root: project.root,
          title: project.project.title,
        });
        if (r.ok) {
          const now = Date.now();
          settingsRefLastBackup.current = now;
          await patchSettings({ lastAutoBackupAt: now });
          setToast("已自动备份");
          window.setTimeout(() => setToast(""), 2400);
        }
      } catch {
        /* ignore */
      } finally {
        busy = false;
      }
    }

    void maybeBackup();
    const tick = Math.min(Math.max(60_000, intervalMs / 12), 15 * 60_000);
    const id = window.setInterval(() => void maybeBackup(), tick);
    return () => window.clearInterval(id);
  }, [project, settings.autoBackupHours, patchSettings]);

  useEffect(() => {
    if (toolsActive) setToolsOpen(true);
  }, [toolsActive]);

  useEffect(() => {
    if (!toolsOpen) return;
    try {
      localStorage.setItem("moshu.toolsNavSeen", "1");
    } catch {
      /* ignore */
    }
  }, [toolsOpen]);

  useEffect(() => {
    applyEditorAppearance(settings);
  }, [settings]);

  useEffect(() => {
    document.documentElement.dataset.editorTheme = theme;
  }, [theme]);

  useEffect(() => {
    void getTodayUsage().then(setToday);
    const id = window.setInterval(() => void getTodayUsage().then(setToday), 8000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!window.moshu?.onUpdateProbe) return;
    void window.moshu.getUpdateStatus?.().then((st: unknown) => {
      const s = st as { probe?: { hasUpdate?: boolean } };
      if (s?.probe?.hasUpdate) setHasUpdate(true);
    });
    return window.moshu.onUpdateProbe((d) => setHasUpdate(Boolean(d.hasUpdate)));
  }, []);

  useEffect(() => {
    void persistSession(loc.pathname.startsWith("/app") ? loc.pathname : "/app/chapter");
  }, [loc.pathname, persistSession]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (matchHotkey(e, keys.focus)) {
        e.preventDefault();
        void patchSettings({ focusMode: !settings.focusMode });
        return;
      }
      if (matchHotkey(e, keys.search)) {
        e.preventDefault();
        if (studioMode) {
          window.dispatchEvent(
            new CustomEvent("moshu:hotkey", { detail: { action: "findInDoc" } })
          );
        } else {
          nav("/app/search");
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("moshu:hotkey", { detail: { action: "focusSearch" } })
            );
          }, 50);
        }
        return;
      }
      if (matchHotkey(e, keys.bookSearch)) {
        e.preventDefault();
        nav("/app/search");
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("moshu:hotkey", { detail: { action: "focusSearch" } })
          );
        }, 50);
        return;
      }
      if (matchHotkey(e, keys.next)) {
        e.preventDefault();
        nextChapter();
        if (!loc.pathname.includes("/chapter")) nav("/app/chapter");
        return;
      }
      if (matchHotkey(e, keys.prev)) {
        e.preventDefault();
        prevChapter();
        if (!loc.pathname.includes("/chapter")) nav("/app/chapter");
        return;
      }
      if (
        matchHotkey(e, keys.save) &&
        ["/app/idea", "/app/outline", "/app/beats", "/app/chapter"].some((p) =>
          loc.pathname.includes(p)
        )
      ) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("moshu:hotkey", { detail: { action: "save" } }));
        return;
      }
      if (
        matchHotkey(e, keys.generate) &&
        ["/app/idea", "/app/outline", "/app/beats", "/app/chapter"].some((p) =>
          loc.pathname.includes(p)
        ) &&
        target?.tagName === "TEXTAREA"
      ) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("moshu:hotkey", { detail: { action: "generate" } }));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "\\" || e.key === "、") && !inField) {
        e.preventDefault();
        void patchSettings({ focusMode: !settings.focusMode });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, settings.focusMode, patchSettings, nextChapter, prevChapter, loc.pathname, nav, studioMode]);

  useEffect(() => {
    if (!chapterId || !chapterListRef.current) return;
    const el = chapterListRef.current.querySelector(".chapter-nav-item.on");
    el?.scrollIntoView({ block: "nearest" });
  }, [chapterId, prog?.chapterRows.length, loc.pathname]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }

  async function quickExport() {
    if (!project) return;
    setMenuOpen(false);
    try {
      await exportBook({
        root: project.root,
        join,
        title: project.project.title,
        format: "qidian",
      });
      flash("已导出 TXT");
    } catch {
      flash("导出失败");
    }
  }

  async function zipBackup() {
    if (!project || !window.moshu?.zipProjectBackup) return;
    setMenuOpen(false);
    try {
      const r = await window.moshu.zipProjectBackup({
        root: project.root,
        title: project.project.title,
      });
      flash(r.ok ? "已备份到下载目录" : r.message);
      if (r.ok && r.filePath) void window.moshu.showItemInFolder?.(r.filePath);
    } catch {
      flash("备份失败");
    }
  }

  async function openBookFolder() {
    if (!project || !window.moshu?.openPath) return;
    setMenuOpen(false);
    await window.moshu.openPath(project.root);
  }

  async function switchBook(folder: string) {
    if (!window.moshu || folder === project?.root) return;
    try {
      await persistSession(loc.pathname.startsWith("/app") ? loc.pathname : "/app/chapter");
      const opened = await window.moshu.openProject(folder);
      setProject(opened);
      const sess = await loadSessionForRoot(folder);
      setChapterId(sess?.chapterId || "第1章");
      setChapterTitle(sess?.chapterTitle || "开端");
      if (sess?.volumeId) setVolumeId(sess.volumeId);
      else setVolumeId("第1卷");
      await refreshRecent();
      nav(sess?.route || "/app/chapter");
    } catch {
      /* ignore */
    }
  }

  function jumpChapter(id: string, title: string, hasChapter: boolean, volId?: string) {
    setChapterId(id);
    setChapterTitle(title);
    if (volId) setVolumeId(volId);
    nav(hasChapter || loc.pathname.includes("/chapter") ? "/app/chapter" : "/app/beats");
  }

  async function addVolume() {
    if (!project || !window.moshu) return;
    const rows = prog?.volumeRows || [];
    const max = Math.max(
      0,
      ...rows.map((v) => Number(v.id.match(/\d+/)?.[0] || 0)),
      Number(volumeId.match(/\d+/)?.[0] || 0)
    );
    const nextId = `第${max + 1}卷`;
    await ensureVolumeBeatsFile({ root: project.root, join, volumeId: nextId });
    setVolumeId(nextId);
    nav("/app/beats");
    void refresh();
    flash(`已新建 ${nextId}`);
  }

  function mark(key: "idea" | "outline" | "beats" | "chapter") {
    if (!prog) return "";
    if (key === "idea") return prog.hasBible || prog.hasSeed ? "✓" : "";
    if (key === "outline") return prog.hasOutline ? "✓" : "";
    if (key === "beats") {
      if (!prog.chapterTotal) return "";
      return `${prog.beatsDone}/${prog.chapterTotal}`;
    }
    if (key === "chapter") {
      if (!prog.chapterTotal) return "";
      return `${prog.chaptersDone}/${prog.chapterTotal}`;
    }
    return "";
  }

  return (
    <div
      className={`app-shell theme-${theme} ${focusMode ? "focus-mode" : ""} ${
        studioMode ? "ide-mode" : ""
      }`}
    >
      <AnnouncementBanner
        versionCode={versionCode}
        meta={appMeta}
        forceUpdate={forceUpdate}
        forceUpdateHint={forceHint}
        onDownloadUpdate={() => void window.moshu?.checkForUpdates?.()}
      />

      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand brand-compact">
            <div className="brand-mark">墨枢</div>
            <NavLink to="/" className="brand-home" title="回首页">
              首页
            </NavLink>
          </div>

          {recent.length > 0 ? (
            <div className="book-switch">
              <select
                value={project?.root || ""}
                onChange={(e) => void switchBook(e.target.value)}
                aria-label="切换书稿"
              >
                {!project && <option value="">选择书稿…</option>}
                {recent.map((r) => (
                  <option key={r.path} value={r.path}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="book-switch-empty muted">尚未打开书稿</div>
          )}
        </div>

        <nav className="nav nav-main" aria-label="写作主流程">
          {mainLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `nav-step ${isActive || loc.pathname === l.to ? "active" : ""}`
              }
            >
              <span className="nav-step-num">{l.step}</span>
              <span className="nav-step-label">{l.label}</span>
              <span className="nav-progress">{mark(l.key)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="nav-tools">
          <button
            type="button"
            className={`nav-tools-toggle ${toolsOpen || toolsActive ? "open" : ""}`}
            onClick={() => setToolsOpen((v) => !v)}
          >
            <span>工具与资料</span>
            <span className="nav-tools-caret">{toolsOpen ? "▾" : "▸"}</span>
            {jobCount > 0 && <span className="badge-dot">{jobCount}</span>}
            {hasUpdate && <span className="badge-dot soft">新</span>}
          </button>
          {toolsOpen && (
            <nav className="nav nav-sub" aria-label="工具">
              {toolLinks.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) => (isActive || loc.pathname === l.to ? "active" : "")}
                >
                  {l.label}
                  {l.to === "/app/status" && jobCount > 0 ? (
                    <span className="nav-progress warn"> {jobCount}</span>
                  ) : null}
                  {l.to === "/app/settings" && hasUpdate ? (
                    <span className="nav-progress"> 新</span>
                  ) : null}
                </NavLink>
              ))}
            </nav>
          )}
        </div>

        {project && loc.pathname.startsWith("/app/beats") && (
          <div className="chapter-nav">
            <div className="chapter-nav-head">
              <span>卷目录</span>
              <button
                type="button"
                className="linkish"
                onClick={() => void addVolume()}
                title="新建下一卷细纲"
              >
                +新建卷
              </button>
            </div>
            <div className="chapter-nav-list">
              {(() => {
                const rows = [...(prog?.volumeRows || [])];
                if (!rows.some((v) => v.id === volumeId)) {
                  rows.push({
                    id: volumeId,
                    title: volumeId,
                    chapterCount: 0,
                    hasContent: false,
                  });
                }
                rows.sort(
                  (a, b) =>
                    Number(a.id.match(/\d+/)?.[0] || 0) - Number(b.id.match(/\d+/)?.[0] || 0)
                );
                return rows.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    className={`chapter-nav-item ${v.id === volumeId ? "on" : ""} ${
                      v.hasContent ? "done" : ""
                    }`}
                    onClick={() => {
                      setVolumeId(v.id);
                      if (!loc.pathname.startsWith("/app/beats")) nav("/app/beats");
                    }}
                    title={v.hasContent ? `${v.chapterCount} 章` : "未写"}
                  >
                    <span className="chapter-nav-id">
                      {v.id.replace("第", "").replace("卷", "")}
                    </span>
                    <span className="chapter-nav-title">
                      {v.title !== v.id ? v.title : v.id}
                      {v.chapterCount > 0 ? ` · ${v.chapterCount}章` : ""}
                    </span>
                    {v.hasContent ? <span className="chapter-nav-dot" /> : null}
                  </button>
                ));
              })()}
            </div>
          </div>
        )}

        {project && prog && prog.chapterRows.length > 0 && !loc.pathname.startsWith("/app/beats") && (
          <div className="chapter-nav">
            <div className="chapter-nav-head">
              <span>章目录（跟细纲）</span>
              <span className="muted">
                {prog.chaptersDone}/{prog.chapterTotal}
              </span>
            </div>
            <input
              className="chapter-nav-filter"
              value={chapterFilter}
              onChange={(e) => setChapterFilter(e.target.value)}
              placeholder="过滤章号/标题…"
              aria-label="过滤章节"
            />
            <div className="chapter-nav-list" ref={chapterListRef}>
              {prog.chapterRows
                .filter((r) => {
                  const q = chapterFilter.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    r.id.toLowerCase().includes(q) ||
                    r.title.toLowerCase().includes(q) ||
                    r.volumeId.toLowerCase().includes(q)
                  );
                })
                .map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={`chapter-nav-item ${r.id === chapterId ? "on" : ""} ${
                    r.hasChapter ? "done" : ""
                  }`}
                  onClick={() => jumpChapter(r.id, r.title, r.hasChapter, r.volumeId)}
                  title={`${r.volumeId}${r.hasChapter ? ` · ${r.words} 字` : " · 未写"}${
                    r.hasBeats ? "" : " · 缺细纲"
                  }`}
                >
                  <span className="chapter-nav-id">{r.id.replace("第", "").replace("章", "")}</span>
                  <span className="chapter-nav-title">
                    {!r.hasBeats ? "⚠ " : ""}
                    {r.title}
                  </span>
                  {r.hasChapter ? <span className="chapter-nav-dot" /> : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {jobCount > 0 && (
          <button type="button" className="retry-banner" onClick={() => nav("/app/status")}>
            {jobCount} 个任务失败，去重试
          </button>
        )}

        <div className="sidebar-foot">
          <div className="foot-status">
            <span className={`status-dot ${llmReady ? "ok" : "bad"}`} />
            <span>{llmReady ? "引擎就绪" : "未配置 Key"}</span>
            {!llmReady && (
              <button type="button" className="linkish" onClick={() => nav("/setup")}>
                去配置
              </button>
            )}
          </div>

          <button type="button" className="today-chip" onClick={() => nav("/")} title="看近 7 日用量与费用">
            <div className="today-chip-row">
              <span>今日 {today.words.toLocaleString()} 字</span>
              <span className="muted today-chip-cost" title={formatCny(today.costCny)}>
                {today.costCny > 0
                  ? formatCny(today.costCny).replace(/^≈\s*/, "")
                  : "¥0"}
              </span>
            </div>
            <div className="goal-bar">
              <div className="goal-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </button>

          <div className="sidebar-appear">
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => setSideAppearOpen((v) => !v)}
            >
              {sideAppearOpen ? "收起侧栏配色" : "侧栏配色"}
            </button>
            {sideAppearOpen && (
              <>
                <span className="sidebar-appear-label">底 / 字 / 次要字 · 字号</span>
                <label className="studio-color" title="侧栏背景">
                  <span>底</span>
                  <input
                    type="color"
                    value={sideColors.bg}
                    onChange={(e) => {
                      const next = { ...settings, sidebarBgColor: e.target.value };
                      applyEditorAppearance(next);
                      void patchSettings({ sidebarBgColor: e.target.value });
                    }}
                  />
                </label>
                <label className="studio-color" title="侧栏主文字">
                  <span>字</span>
                  <input
                    type="color"
                    value={sideColors.fg}
                    onChange={(e) => {
                      const next = { ...settings, sidebarFgColor: e.target.value };
                      applyEditorAppearance(next);
                      void patchSettings({ sidebarFgColor: e.target.value });
                    }}
                  />
                </label>
                <label className="studio-color" title="章目录等次要文字">
                  <span>次</span>
                  <input
                    type="color"
                    value={sideColors.muted}
                    onChange={(e) => {
                      const next = { ...settings, sidebarMutedColor: e.target.value };
                      applyEditorAppearance(next);
                      void patchSettings({ sidebarMutedColor: e.target.value });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  onClick={() => {
                    const size = Math.max(11, (settings.sidebarFontSize || 13) - 1);
                    const next = { ...settings, sidebarFontSize: size };
                    applyEditorAppearance(next);
                    void patchSettings({ sidebarFontSize: size });
                  }}
                >
                  A−
                </button>
                <span className="sidebar-appear-size">{settings.sidebarFontSize || 13}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  onClick={() => {
                    const size = Math.min(18, (settings.sidebarFontSize || 13) + 1);
                    const next = { ...settings, sidebarFontSize: size };
                    applyEditorAppearance(next);
                    void patchSettings({ sidebarFontSize: size });
                  }}
                >
                  A+
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  onClick={() => {
                    const patch = sidebarPresetPatch(
                      (settings.editorTheme as EditorThemeId) || "ink"
                    );
                    applyEditorAppearance({ ...settings, ...patch });
                    void patchSettings(patch);
                  }}
                >
                  跟主题
                </button>
              </>
            )}
          </div>

          <div className="foot-actions" ref={menuRef}>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => void patchSettings({ focusMode: !focusMode })}
            >
              {focusMode ? "退出专注" : "专注"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
            >
              更多
            </button>
            {menuOpen && (
              <div className="side-menu">
                <button type="button" disabled={!project} onClick={() => void openBookFolder()}>
                  打开书稿文件夹
                </button>
                <button type="button" disabled={!project} onClick={() => void quickExport()}>
                  导出 TXT
                </button>
                <button type="button" disabled={!project} onClick={() => void zipBackup()}>
                  备份 Zip
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    nav("/app/settings");
                  }}
                >
                  设置
                </button>
              </div>
            )}
          </div>
          {toast && <div className="side-toast">{toast}</div>}
        </div>
      </aside>

      {focusMode && (
        <button
          type="button"
          className="focus-exit-btn"
          onClick={() => void patchSettings({ focusMode: false })}
        >
          显示侧栏
        </button>
      )}

      <div className="workspace">
        {!license.ok && (
          <div className="license-callout" role="status">
            <span>{license.reason}</span>
            <button type="button" className="linkish" onClick={() => nav("/app/settings")}>
              去设置填写授权码
            </button>
          </div>
        )}
        {project && !studioMode && (
          <header className="topbar">
            <div className="topbar-left">
              <strong className="topbar-title">《{project.project.title}》</strong>
              <span className="topbar-sep">·</span>
              <span className="muted">{chapterId}</span>
              {prog && prog.wordsTotal > 0 && (
                <>
                  <span className="topbar-sep">·</span>
                  <span className="muted">全文 {prog.wordsTotal.toLocaleString()} 字</span>
                </>
              )}
            </div>
            <div className="topbar-right">
              <button type="button" className="btn btn-ghost btn-compact" onClick={() => nav("/app/search")}>
                搜索
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => {
                  prevChapter();
                  nav("/app/chapter");
                }}
              >
                上一章
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => {
                  nextChapter();
                  nav("/app/chapter");
                }}
              >
                下一章
              </button>
              <button
                type="button"
                className="btn btn-primary btn-compact"
                onClick={() => nav("/app/chapter")}
              >
                去写作
              </button>
            </div>
          </header>
        )}
        <main className={`main ${studioMode ? "main-studio" : ""}`}>
          {projectChecklist && (
            <div className="panel" style={{ marginBottom: 12, padding: "10px 14px" }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                开书清单（完成一项会自动消失）
              </div>
              <ol className="empty-guide-steps" style={{ margin: 0 }}>
                {projectChecklist.map((s) => (
                  <li key={s.to} style={{ opacity: s.done ? 0.45 : 1 }}>
                    {s.done ? (
                      <span>✓ {s.text}</span>
                    ) : (
                      <NavLink to={s.to}>{s.text}</NavLink>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
