import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { confirmAction } from "../lib/confirm";
import { loadProjectProgress } from "../lib/projectProgress";
import {
  clearReviseSession,
  createReviseSession,
  loadReviseSession,
  saveReviseSession,
  type ReviseSession,
} from "../lib/reviseQueue";
import { loadTabooList, scanTaboo } from "../lib/scan";
import { useApp } from "../state/AppContext";

export function RevisePage() {
  const nav = useNavigate();
  const { project, join, setChapterId, setChapterTitle } = useApp();
  const [session, setSession] = useState<ReviseSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const reload = useCallback(async () => {
    if (!project) return;
    setSession(await loadReviseSession(project.root, join));
  }, [project, join]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function startTabooScan() {
    if (!project || !window.moshu) return;
    if (session?.items.some((i) => i.status === "pending")) {
      if (!confirmAction("已有未完成的改稿任务，确定重新开始全书扫禁忌？")) return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const prog = await loadProjectProgress(project.root, join);
      const chapters = prog.chapterRows
        .filter((r) => r.hasChapter)
        .map((r) => ({ chapterId: r.id, chapterTitle: r.title }));
      if (!chapters.length) {
        setErr("还没有已写正文，无法扫禁忌");
        return;
      }
      const next = createReviseSession("scan_taboo", chapters);
      await saveReviseSession(project.root, join, next);
      setSession(next);
      setMsg(`已创建 ${chapters.length} 章禁忌扫描任务`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function continueScan() {
    if (!project || !window.moshu || !session || session.kind !== "scan_taboo") return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const taboo = await loadTabooList(project.root, join);
      const files = await window.moshu.listDir(await join(project.root, "chapters"));
      const byId = new Map(
        files
          .filter((f) => f.name.endsWith(".md"))
          .map((f) => {
            const m = f.name.match(/^(第\d+章)/);
            return [m?.[1] || f.name.replace(/\.md$/, ""), f] as const;
          })
      );
      const items = [...session.items];
      let processed = 0;
      const batch = 8;
      for (let i = 0; i < items.length && processed < batch; i++) {
        if (items[i].status !== "pending") continue;
        const file = byId.get(items[i].chapterId);
        if (!file) {
          items[i] = { ...items[i], status: "skipped", detail: "找不到正文文件" };
          processed++;
          continue;
        }
        try {
          const body = await window.moshu.readText(file.path);
          const hits = scanTaboo(body, taboo);
          items[i] = {
            ...items[i],
            status: "done",
            detail: hits.length
              ? hits.map((h) => `${h.text}（${h.detail}）`).join("；")
              : "通过",
          };
        } catch (e) {
          items[i] = {
            ...items[i],
            status: "failed",
            detail: e instanceof Error ? e.message : String(e),
          };
        }
        processed++;
      }
      const next = { ...session, items };
      await saveReviseSession(project.root, join, next);
      setSession(next);
      const pending = items.filter((x) => x.status === "pending").length;
      setMsg(pending ? `本批处理 ${processed} 章，剩余 ${pending}` : "全书扫禁忌已完成");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearSession() {
    if (!project) return;
    if (!confirmAction("清空改稿任务队列？")) return;
    await clearReviseSession(project.root, join);
    setSession(null);
    setMsg("已清空");
  }

  if (!project) {
    return (
      <div className="panel">
        <Link to="/">回首页</Link>
      </div>
    );
  }

  const pending = session?.items.filter((i) => i.status === "pending").length || 0;
  const done = session?.items.filter((i) => i.status === "done").length || 0;
  const failed = session?.items.filter((i) => i.status === "failed").length || 0;
  const flagged = session?.items.filter(
    (i) => i.status === "done" && i.detail && i.detail !== "通过"
  );

  return (
    <div className="stack">
      <div>
        <h2 className="h2">改稿队列</h2>
        <p className="muted">全书扫禁忌（仅禁忌词）；进度持久化，可分批继续。</p>
      </div>

      <div className="panel stack">
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void startTabooScan()}>
            {busy ? "处理中…" : "全书扫禁忌"}
          </button>
          <button
            className="btn"
            disabled={busy || !pending}
            onClick={() => void continueScan()}
          >
            继续（每批 8 章）
          </button>
          <button className="btn btn-ghost" disabled={busy || !session} onClick={() => void clearSession()}>
            清空队列
          </button>
          <button className="btn btn-ghost" onClick={() => nav("/app/status")}>
            进度导出
          </button>
        </div>
        {session && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            任务 {session.id} · 待办 {pending} · 完成 {done} · 失败 {failed}
          </p>
        )}
        {msg && <p className="ok-text">{msg}</p>}
        {err && <p className="toast">{err}</p>}
      </div>

      {flagged && flagged.length > 0 && (
        <div className="panel stack">
          <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>命中禁忌</h3>
          {flagged.map((item) => (
            <div
              key={item.chapterId}
              className="list-card"
              role="button"
              tabIndex={0}
              onClick={() => {
                setChapterId(item.chapterId);
                setChapterTitle(item.chapterTitle);
                nav("/app/chapter");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setChapterId(item.chapterId);
                  setChapterTitle(item.chapterTitle);
                  nav("/app/chapter");
                }
              }}
            >
              <strong>
                {item.chapterId} {item.chapterTitle}
              </strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {item.detail}
              </div>
            </div>
          ))}
        </div>
      )}

      {session && (
        <div className="panel stack">
          <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>全部条目</h3>
          <div className="stack" style={{ maxHeight: 360, overflow: "auto" }}>
            {session.items.map((item) => (
              <div key={item.chapterId} className="list-card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>
                    {item.chapterId} {item.chapterTitle}
                  </strong>
                  <span className={`mini-badge ${item.status === "done" ? "ok" : ""}`}>
                    {item.status}
                  </span>
                </div>
                {item.detail && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {item.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
