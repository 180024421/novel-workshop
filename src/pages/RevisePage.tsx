import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { backupChapter } from "../lib/backup";
import { buildChapterIndex, syncChapterFileName } from "../lib/chapterFiles";
import { confirmAction } from "../lib/confirm";
import { craftFixPrompt } from "../lib/craftFix";
import { chatCompletion, humanizeLlmError } from "../lib/gateway";
import { loadProjectProgress } from "../lib/projectProgress";
import { SYSTEM_WRITER } from "../lib/prompts";
import {
  clearReviseSession,
  createReviseSession,
  loadReviseSession,
  saveReviseSession,
  type ReviseSession,
} from "../lib/reviseQueue";
import { loadTabooList, scanCraftIssues, scanTaboo } from "../lib/scan";
import { addUsage } from "../lib/usageLedger";
import { useApp } from "../state/AppContext";

export function RevisePage() {
  const nav = useNavigate();
  const { project, join, setChapterId, setChapterTitle, settings, providers, llmReady } = useApp();
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

  async function listWrittenChapters() {
    if (!project) return [];
    const prog = await loadProjectProgress(project.root, join);
    return prog.chapterRows
      .filter((r) => r.hasChapter)
      .map((r) => ({ chapterId: r.id, chapterTitle: r.title }));
  }

  async function startTabooScan() {
    if (!project || !window.moshu) return;
    if (session?.items.some((i) => i.status === "pending")) {
      if (!(await confirmAction("已有未完成的改稿任务，确定重新开始全书扫禁忌？"))) return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const chapters = await listWrittenChapters();
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

  async function startCraftPolish() {
    if (!project || !window.moshu) return;
    if (!llmReady) {
      setErr("请先配置模型 Key");
      return;
    }
    if (session?.items.some((i) => i.status === "pending")) {
      if (!(await confirmAction("已有未完成的改稿任务，确定改为批量工艺润色？"))) return;
    }
    if (
      !(await confirmAction(
        "将对有正文的章节逐章：备份 → 工艺润色 → 写回。可能产生费用，且耗时较长。继续？"
      ))
    ) {
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const chapters = await listWrittenChapters();
      if (!chapters.length) {
        setErr("还没有已写正文");
        return;
      }
      const next = createReviseSession("craft_polish", chapters);
      await saveReviseSession(project.root, join, next);
      setSession(next);
      setMsg(`已创建 ${chapters.length} 章工艺润色任务（请点「继续」分批执行）`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function continueScan() {
    if (!project || !window.moshu || !session) return;
    if (session.kind === "craft_polish") {
      await continueCraftPolish();
      return;
    }
    if (session.kind !== "scan_taboo") return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const taboo = await loadTabooList(project.root, join);
      const files = await window.moshu.listDir(await join(project.root, "chapters"));
      const byId = buildChapterIndex(files);
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

  async function continueCraftPolish() {
    if (!project || !window.moshu || !session || session.kind !== "craft_polish") return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const files = await window.moshu.listDir(await join(project.root, "chapters"));
      const byId = buildChapterIndex(files);
      const items = [...session.items];
      let processed = 0;
      const batch = 2;
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
          if (!body.trim()) {
            items[i] = { ...items[i], status: "skipped", detail: "正文为空" };
            processed++;
            continue;
          }
          await backupChapter({
            root: project.root,
            join,
            chapterId: items[i].chapterId,
            body,
            note: "批量工艺润色前",
          });
          const hits = scanCraftIssues(body);
          const nextBody = await chatCompletion(
            settings,
            [
              { role: "system", content: SYSTEM_WRITER },
              { role: "user", content: craftFixPrompt({ body, hits }) },
            ],
            {
              providers,
              model: settings.routeCheck || settings.routeChapter || "复杂",
              maxTokens: 12000,
            }
          );
          if (!nextBody.trim() || nextBody.trim().length < body.trim().length * 0.5) {
            items[i] = {
              ...items[i],
              status: "failed",
              detail: "润色结果过短，已保留原文（可在 revisions 回滚）",
            };
            await addUsage({ writeFail: 1 });
            processed++;
            continue;
          }
          await syncChapterFileName({
            root: project.root,
            join,
            chapterId: items[i].chapterId,
            title: items[i].chapterTitle || "未命名",
            body: nextBody,
          });
          items[i] = {
            ...items[i],
            status: "done",
            detail: `已润色并写回（命中 ${hits.length} 处启发式）；备份见 revisions`,
          };
          await addUsage({ writeOk: 1 });
        } catch (e) {
          items[i] = {
            ...items[i],
            status: "failed",
            detail: humanizeLlmError(e),
          };
          await addUsage({ writeFail: 1 });
        }
        processed++;
      }
      const next = { ...session, items };
      await saveReviseSession(project.root, join, next);
      setSession(next);
      const pending = items.filter((x) => x.status === "pending").length;
      setMsg(
        pending
          ? `本批工艺润色 ${processed} 章，剩余 ${pending}（点继续）`
          : "批量工艺润色已完成"
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearSession() {
    if (!project) return;
    if (!(await confirmAction("清空改稿任务队列？"))) return;
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
    (i) =>
      i.status === "done" &&
      i.detail &&
      i.detail !== "通过" &&
      session.kind === "scan_taboo"
  );
  const kindLabel =
    session?.kind === "craft_polish"
      ? "批量工艺润色"
      : session?.kind === "scan_taboo"
        ? "全书扫禁忌"
        : session?.kind || "";

  return (
    <div className="stack">
      <div>
        <h2 className="h2">改稿队列</h2>
        <p className="muted">
          全书扫禁忌，或批量工艺润色（逐章备份写回，可分批继续）。单章 Diff 请到正文工具打开对应备份。
        </p>
      </div>

      <div className="panel stack">
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void startTabooScan()}>
            {busy ? "处理中…" : "全书扫禁忌"}
          </button>
          <button className="btn" disabled={busy} onClick={() => void startCraftPolish()}>
            批量工艺润色
          </button>
          <button
            className="btn"
            disabled={busy || !pending}
            onClick={() => void continueScan()}
          >
            继续（
            {session?.kind === "craft_polish" ? "每批 2 章" : "每批 8 章"}）
          </button>
          <button className="btn btn-ghost" disabled={busy || !session} onClick={() => void clearSession()}>
            清空队列
          </button>
          <button className="btn btn-ghost" onClick={() => nav("/app/chapter")}>
            去正文润色
          </button>
        </div>
        {session && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {kindLabel} · 任务 {session.id} · 待办 {pending} · 完成 {done} · 失败 {failed}
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
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  style={{ marginTop: 4 }}
                  onClick={() => {
                    setChapterId(item.chapterId);
                    setChapterTitle(item.chapterTitle);
                    nav("/app/chapter");
                  }}
                >
                  打开该章
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
