import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { backupChapter } from "../lib/backup";
import { buildChapterIndex, syncChapterFileName } from "../lib/chapterFiles";
import {
  applyComplianceSuggestion,
  runBookCompliance,
  type ComplianceHit,
  type ComplianceLevel,
} from "../lib/compliance";
import { confirmAction } from "../lib/confirm";
import { useApp } from "../state/AppContext";

export function CompliancePage() {
  const nav = useNavigate();
  const { project, join, setChapterId, setChapterTitle } = useApp();
  const [hits, setHits] = useState<ComplianceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<ComplianceLevel | "全部">("全部");

  async function scan() {
    if (!project) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const list = await runBookCompliance(project.root, join);
      setHits(list);
      setMsg(list.length ? `检出 ${list.length} 处` : "未检出风险词");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, join]);

  const shown = useMemo(
    () => (filter === "全部" ? hits : hits.filter((h) => h.level === filter)),
    [hits, filter]
  );

  function jump(h: ComplianceHit) {
    if (!h.chapterId) return;
    setChapterId(h.chapterId);
    setChapterTitle(h.chapterTitle || h.chapterId);
    nav("/app/chapter");
  }

  async function applyOne(h: ComplianceHit) {
    if (!project || !window.moshu || !h.chapterId) return;
    if (
      !(await confirmAction(
        `对 ${h.chapterId} 应用替换建议？将先备份再改写首次出现的「${h.word}」。`
      ))
    ) {
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const files = await window.moshu.listDir(await join(project.root, "chapters"));
      const byId = buildChapterIndex(files);
      const file = byId.get(h.chapterId);
      if (!file) throw new Error("找不到章文件");
      const body = await window.moshu.readText(file.path);
      await backupChapter({
        root: project.root,
        join,
        chapterId: h.chapterId,
        body,
        note: "过审替换前备份",
      });
      const next = applyComplianceSuggestion(body, h);
      await syncChapterFileName({
        root: project.root,
        join,
        chapterId: h.chapterId,
        title: h.chapterTitle || h.chapterId,
        body: next,
      });
      setMsg(`已改写 ${h.chapterId}，可在正文 Diff/备份回退`);
      await scan();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!project) {
    return (
      <div className="panel">
        <p className="muted">请先打开书稿。</p>
        <Link className="btn" to="/">
          回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 className="h2">过审检查</h2>
          <p className="muted">
            本地扫描 prompts/compliance.md（可用扩展包「过审提示包」写入）。不耗 token。
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-ghost btn-compact" to="/app/packs">
            扩展包
          </Link>
          <button
            type="button"
            className="btn btn-compact"
            disabled={busy}
            onClick={() => void scan()}
          >
            {busy ? "扫描中…" : "重新扫描"}
          </button>
        </div>
      </div>

      {err && <p className="err">{err}</p>}
      {msg && <p className="muted">{msg}</p>}

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {(["全部", "高危", "中", "建议"] as const).map((lv) => (
          <button
            key={lv}
            type="button"
            className={`btn btn-ghost btn-compact ${filter === lv ? "active" : ""}`}
            onClick={() => setFilter(lv)}
          >
            {lv}
            {lv !== "全部"
              ? ` (${hits.filter((h) => h.level === lv).length})`
              : ` (${hits.length})`}
          </button>
        ))}
      </div>

      <div className="panel stack">
        {shown.length === 0 ? (
          <p className="muted">当前筛选下无命中。</p>
        ) : (
          shown.map((h, i) => (
            <div
              key={`${h.chapterId}-${h.word}-${i}`}
              className="scan-box"
              style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}
            >
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="badge">{h.level}</span>
                <strong>{h.word}</strong>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  onClick={() => jump(h)}
                >
                  {h.chapterId}
                </button>
                {h.suggestion && (
                  <button
                    type="button"
                    className="btn btn-compact"
                    disabled={busy}
                    onClick={() => void applyOne(h)}
                  >
                    应用建议
                  </button>
                )}
              </div>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                {h.context}
                {h.suggestion ? ` · 建议：${h.suggestion}` : ""}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
