import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  loadSummaries,
  saveSummaries,
  type ChapterSummary,
  type SummariesLedger,
} from "../lib/summaries";
import { useApp } from "../state/AppContext";

export function SummariesPage() {
  const { project, join } = useApp();
  const [ledger, setLedger] = useState<SummariesLedger>({ items: [], updatedAt: "" });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!project) return;
    const next = await loadSummaries(project.root, join);
    setLedger(next);
    const map: Record<string, string> = {};
    for (const it of next.items) map[it.chapterId] = it.summary;
    setDrafts(map);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, join]);

  async function saveOne(item: ChapterSummary) {
    if (!project) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const summary = (drafts[item.chapterId] ?? item.summary).trim();
      const items = ledger.items.map((x) =>
        x.chapterId === item.chapterId
          ? { ...x, summary, updatedAt: new Date().toISOString() }
          : x
      );
      const next = { items, updatedAt: new Date().toISOString() };
      await saveSummaries(project.root, join, next);
      setLedger(next);
      setMsg(`已保存 ${item.chapterId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (!project) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const items = ledger.items.map((x) => ({
        ...x,
        summary: (drafts[x.chapterId] ?? x.summary).trim(),
        updatedAt: new Date().toISOString(),
      }));
      const next = { items, updatedAt: new Date().toISOString() };
      await saveSummaries(project.root, join, next);
      setLedger(next);
      setMsg(`已保存全部 ${items.length} 条摘要`);
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
      <div>
        <h2 className="h2">章摘要看板</h2>
        <p className="muted">编辑 continuity/summaries.json，写后续章时会注入近章摘要。</p>
      </div>
      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {ledger.items.length} 条
            {ledger.updatedAt ? ` · 更新 ${ledger.updatedAt.slice(0, 19).replace("T", " ")}` : ""}
          </span>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-compact" onClick={() => void reload()}>
              刷新
            </button>
            <button
              type="button"
              className="btn btn-primary btn-compact"
              disabled={busy || !ledger.items.length}
              onClick={() => void saveAll()}
            >
              全部保存
            </button>
          </div>
        </div>
        {msg && <p className="ok-text">{msg}</p>}
        {err && <p className="toast">{err}</p>}
        {!ledger.items.length && <p className="muted">暂无摘要。写章成功后会自动生成。</p>}
        {ledger.items.map((it) => (
          <div key={it.chapterId} className="list-card stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <strong>
                {it.chapterId} · {it.title || "无标题"}
              </strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {it.words > 0 ? `${it.words} 字` : ""}
              </span>
            </div>
            <textarea
              rows={3}
              value={drafts[it.chapterId] ?? ""}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [it.chapterId]: e.target.value }))
              }
              placeholder="章摘要…"
              style={{ width: "100%", minHeight: 72 }}
            />
            <div className="row">
              <button
                type="button"
                className="btn btn-compact"
                disabled={busy}
                onClick={() => void saveOne(it)}
              >
                保存本条
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
