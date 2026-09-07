import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { confirmAction, promptText } from "../lib/confirm";
import { GENRE_LABELS, GENRE_PRESETS } from "../lib/genrePresets";
import { seedSampleProject, SAMPLE } from "../lib/sampleProject";
import { DEMO_3MIN, DEMO_IMPORT_3MIN } from "../lib/demoScript";
import { forgetSessionRoot, loadSession, loadSessionForRoot, saveSession } from "../lib/session";
import { getRecentUsage, getTodayUsage, goalProgress, type DayUsage } from "../lib/usageLedger";
import { formatCny } from "../lib/costEstimate";
import { useApp } from "../state/AppContext";

export function HomePage() {
  const nav = useNavigate();
  const {
    recent,
    refreshRecent,
    setProject,
    llmReady,
    setChapterId,
    setChapterTitle,
    setVolumeId,
    settings,
    bootstrapped,
  } = useApp();
  const [title, setTitle] = useState("我的小说");
  const [genre, setGenre] = useState("通用");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [today, setToday] = useState<DayUsage>({ words: 0, costCny: 0 });
  const [recentUsage, setRecentUsage] = useState<
    { date: string; words: number; costCny: number }[]
  >([]);
  const [sessionHint, setSessionHint] = useState("");
  const [invalidSessionRoot, setInvalidSessionRoot] = useState<string | null>(null);
  const [autoTried, setAutoTried] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  const goal = settings.dailyWordGoal || 2000;
  const pct = goalProgress(today.words, goal);
  const hasResume = Boolean(recent.length > 0 || sessionHint);

  useEffect(() => {
    void getTodayUsage().then(setToday);
    void getRecentUsage(7).then(setRecentUsage);
  }, []);

  useEffect(() => {
    if (!bootstrapped || autoTried || !window.moshu) return;
    setAutoTried(true);
    void loadSession().then((s) => {
      if (s?.root) setSessionHint(`上次：《${s.title}》${s.chapterId}`);
    });
    if (settings.autoResume === false) return;
    if (sessionStorage.getItem("moshu.autoResumed") === "1") return;
    (async () => {
      const s = await loadSession();
      if (!s?.root) return;
      try {
        const opened = await window.moshu!.openProject(s.root);
        setProject(opened);
        setChapterId(s.chapterId || "第1章");
        setChapterTitle(s.chapterTitle || "开端");
        if (s.volumeId) setVolumeId(s.volumeId);
        await refreshRecent();
        sessionStorage.setItem("moshu.autoResumed", "1");
        nav(s.route || "/app/chapter");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(`无法打开上次书稿：${msg}`);
        setInvalidSessionRoot(s.root);
      }
    })();
  }, [
    bootstrapped,
    autoTried,
    settings.autoResume,
    setProject,
    setChapterId,
    setChapterTitle,
    setVolumeId,
    refreshRecent,
    nav,
  ]);

  async function clearInvalidSession() {
    if (!invalidSessionRoot) return;
    forgetSessionRoot(invalidSessionRoot);
    await saveSession(null);
    setInvalidSessionRoot(null);
    setSessionHint("");
    setErr("");
  }

  async function resumeLast() {
    setErr("");
    if (!window.moshu) {
      setErr("请用桌面端打开");
      return;
    }
    setBusy(true);
    try {
      const s = await loadSession();
      const path = s?.root || recent[0]?.path;
      if (!path) {
        setErr("没有可续写的项目");
        return;
      }
      const opened = await window.moshu.openProject(path);
      setProject(opened);
      if (s && s.root === path) {
        setChapterId(s.chapterId || "第1章");
        setChapterTitle(s.chapterTitle || "开端");
        if (s.volumeId) setVolumeId(s.volumeId);
        await refreshRecent();
        nav(s.route || "/app/chapter");
      } else {
        const sess = await loadSessionForRoot(path);
        if (sess) {
          setChapterId(sess.chapterId || "第1章");
          setChapterTitle(sess.chapterTitle || "开端");
          if (sess.volumeId) setVolumeId(sess.volumeId);
        }
        await refreshRecent();
        nav(sess?.route || "/app/chapter");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function startWriting(customFolder?: boolean) {
    setErr("");
    if (!llmReady) {
      nav("/setup");
      return;
    }
    if (!window.moshu) {
      setErr("请用桌面端打开：npm run dev:app");
      return;
    }
    setBusy(true);
    try {
      const preset = GENRE_PRESETS.find((g) => g.label === genre) || GENRE_PRESETS[0];
      let opened;
      if (customFolder) {
        const folder = await window.moshu.pickFolder();
        if (!folder) return;
        opened = await window.moshu.createProject({ folder, title, genre });
      } else {
        opened = await window.moshu.createProjectDefault({ title, genre });
      }
      await window.moshu.writeText(
        await window.moshu.joinPath(opened.root, "prompts", "style.md"),
        preset.style
      );
      setProject(opened);
      await refreshRecent();
      nav("/app/idea");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openSample() {
    setErr("");
    if (!window.moshu) {
      setErr("请用桌面端打开");
      return;
    }
    setBusy(true);
    try {
      const opened = await window.moshu.createProjectDefault({
        title: SAMPLE.title,
        genre: SAMPLE.genre,
      });
      await seedSampleProject(opened.root, window.moshu.joinPath.bind(window.moshu));
      setProject(opened);
      await refreshRecent();
      nav("/app/chapter");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openExisting(path?: string) {
    setErr("");
    if (!window.moshu) {
      setErr("请使用桌面端打开。");
      return;
    }
    setBusy(true);
    try {
      const folder = path || (await window.moshu.pickFolder());
      if (!folder) return;
      const opened = await window.moshu.openProject(folder);
      setProject(opened);
      const sess = await loadSessionForRoot(folder);
      if (sess) {
        setChapterId(sess.chapterId || "第1章");
        setChapterTitle(sess.chapterTitle || "开端");
        if (sess.volumeId) setVolumeId(sess.volumeId);
      }
      await refreshRecent();
      nav(sess?.route || "/app/chapter");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function renameBook(path: string, currentTitle: string) {
    setErr("");
    if (!window.moshu?.renameRecent) {
      setErr("请用桌面端打开");
      return;
    }
    const next = await promptText("新书名", currentTitle);
    if (next == null) return;
    const titleTrim = next.trim();
    if (!titleTrim) return;
    setBusy(true);
    try {
      await window.moshu.renameRecent({ path, title: titleTrim });
      await refreshRecent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeFromList(path: string, bookTitle: string) {
    setErr("");
    if (!window.moshu?.removeRecent) {
      setErr("请用桌面端打开");
      return;
    }
    if (
      !(await confirmAction(
        `将「${bookTitle}」从最近列表移除？\n不会删除磁盘上的书稿文件夹。`
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      await window.moshu.removeRecent(path);
      forgetSessionRoot(path);
      await refreshRecent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`hero-home hero-home-fit tone-${settings.editorTheme || "ink"}`} data-page="home">
      <div className="hero-card hero-card-fit">
        <header className="home-head">
          <div>
            <div className="brand-sub">DASHUAI MOSHU</div>
            <h1>大帅墨枢</h1>
          </div>
          <div className="home-today" title={`目标 ${goal.toLocaleString()} 字`}>
            <span>
              今日 <b>{today.words.toLocaleString()}</b> 字
            </span>
            <span className="muted">{formatCny(today.costCny).replace(/^≈\s*/, "")}</span>
            <div className="goal-bar">
              <div className="goal-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            {recentUsage.some((d) => d.words > 0 || d.costCny > 0) && (
              <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
                {recentUsage.map((d) => (
                  <div key={d.date}>
                    {d.date} · {d.words.toLocaleString()} 字 ·{" "}
                    {formatCny(d.costCny).replace(/^≈\s*/, "")}
                  </div>
                ))}
              </div>
            )}
          </div>
        </header>

        <p className="tagline tagline-fit">
          从零 AI 开书，或导入己书改稿：增卷增章、扫描润色、Diff 回退
        </p>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          从零：工艺 → 设定 → 总纲 → 细纲 → 正文 · 导入：拆章 → 补目录/工艺 → 润色 Diff
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => setDemoOpen((v) => !v)}
          >
            {demoOpen ? "收起演示脚本" : "3 分钟演示脚本"}
          </button>
        </div>
        {demoOpen && (
          <div className="stack" style={{ marginBottom: 12, gap: 10 }}>
            <div className="panel stack" style={{ padding: 12 }}>
              <strong>{DEMO_3MIN.title}</strong>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {DEMO_3MIN.steps.map((s) => (
                  <li key={s.n} style={{ marginBottom: 4 }}>
                    {s.text}
                  </li>
                ))}
              </ol>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {DEMO_3MIN.tip}
              </p>
            </div>
            <div className="panel stack" style={{ padding: 12 }}>
              <strong>{DEMO_IMPORT_3MIN.title}</strong>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {DEMO_IMPORT_3MIN.steps.map((s) => (
                  <li key={`i-${s.n}`} style={{ marginBottom: 4 }}>
                    {s.text}
                  </li>
                ))}
              </ol>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {DEMO_IMPORT_3MIN.tip}
              </p>
            </div>
          </div>
        )}

        <div className="home-actions">
          {hasResume ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => void resumeLast()}>
              继续上次写作
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                if (!llmReady) nav("/setup");
                else setShowNew(true);
              }}
            >
              {llmReady ? "开始写新书" : "先配置引擎"}
            </button>
          )}
          {hasResume && (
            <button className="btn" disabled={busy} type="button" onClick={() => setShowNew((v) => !v)}>
              {showNew ? "收起" : "写新书"}
            </button>
          )}
          <button
            className="btn"
            disabled={busy}
            type="button"
            onClick={() => {
              if (!llmReady) nav("/setup");
              else nav("/quick-start");
            }}
          >
            一句话开书
          </button>
          <button
            className="btn"
            disabled={busy}
            type="button"
            onClick={() => nav("/import")}
            title="导入后可增卷增章、AI 润色"
          >
            导入书稿
          </button>
          <button className="btn" disabled={busy} onClick={() => void openExisting()}>
            打开
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void openSample()}>
            样例
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            title="配置 API Key"
            onClick={() => nav("/setup")}
          >
            引擎
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => nav("/app/settings")}>
            设置
          </button>
        </div>

        {sessionHint && <p className="muted home-session">{sessionHint}</p>}

        {invalidSessionRoot && (
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="btn" onClick={() => void clearInvalidSession()}>
              清除无效会话
            </button>
          </div>
        )}

        {showNew && (
          <div className="home-new">
            <input
              className="home-new-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="书名"
              aria-label="书名"
            />
            <select
              className="home-new-genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              aria-label="类型"
            >
              {GENRE_LABELS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={busy} onClick={() => void startWriting(false)}>
              创建并开始
            </button>
            {llmReady && (
              <button className="btn btn-ghost" type="button" onClick={() => void startWriting(true)}>
                换位置…
              </button>
            )}
          </div>
        )}

        {recent.length > 0 && (
          <div className="home-workbench">
            <span className="muted">书稿工作台</span>
            {recent.map((r) => (
              <div key={r.path} className="home-book-card">
                <button
                  type="button"
                  className="home-book-card-main"
                  title={r.path}
                  disabled={busy}
                  onClick={() => void openExisting(r.path)}
                >
                  <div>{r.title}</div>
                  <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                    {r.path}
                  </div>
                </button>
                <div className="home-book-card-actions">
                  <button
                    type="button"
                    className="btn btn-compact"
                    disabled={busy}
                    onClick={() => void openExisting(r.path)}
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={busy}
                    onClick={() => void renameBook(r.path, r.title)}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    disabled={busy}
                    onClick={() => void removeFromList(r.path, r.title)}
                  >
                    从列表移除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {err && <p className="toast home-err">{err}</p>}
      </div>
    </div>
  );
}
