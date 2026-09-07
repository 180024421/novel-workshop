import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  computeBookHealth,
  projectHasCraftRules,
  type BookHealthReport,
} from "../lib/bookHealth";
import { useApp } from "../state/AppContext";

export function HealthPage() {
  const { project, join } = useApp();
  const [report, setReport] = useState<BookHealthReport | null>(null);
  const [hasCraft, setHasCraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function reload() {
    if (!project) return;
    setBusy(true);
    setErr("");
    try {
      const [r, craft] = await Promise.all([
        computeBookHealth(project.root, join),
        projectHasCraftRules(project.root, join),
      ]);
      setReport(r);
      setHasCraft(craft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, join]);

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
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 className="h2">本书健康分</h2>
          <p className="muted">细纲覆盖 · 开放钩子 · 工艺病密度 · 缺摘要 — 质检收成一页。</p>
        </div>
        <button type="button" className="btn btn-ghost btn-compact" disabled={busy} onClick={() => void reload()}>
          {busy ? "计算中…" : "刷新"}
        </button>
      </div>

      {!hasCraft && (
        <div className="panel" style={{ borderColor: "var(--warn, #c90)" }}>
          <p style={{ margin: 0 }}>
            尚未检测到工艺红线。建议先到{" "}
            <Link to="/app/packs">扩展包</Link> 点「一键补工艺红线」，再写章。
          </p>
        </div>
      )}

      {err && <p className="toast">{err}</p>}

      {report && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">综合分</div>
              <div className="stat-value">
                {report.score}
                <span className="muted" style={{ fontSize: 14, marginLeft: 8 }}>
                  / 100 · {report.grade}
                </span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">有正文章数</div>
              <div className="stat-value">{report.chaptersWithBody}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">未解钩子</div>
              <div className="stat-value">{report.openHooks}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">缺摘要</div>
              <div className="stat-value">{report.missingSummaries}</div>
            </div>
          </div>

          <div className="panel stack">
            {report.dimensions.map((d) => (
              <div key={d.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{d.label}</strong>
                  <span className="muted">
                    {d.score}/{d.max}
                  </span>
                </div>
                <div className="goal-bar" style={{ margin: "6px 0" }}>
                  <div
                    className="goal-bar-fill"
                    style={{ width: `${Math.round((d.score / d.max) * 100)}%` }}
                  />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {d.detail}
                  {d.hintTo ? (
                    <>
                      {" · "}
                      <Link to={d.hintTo}>去处理</Link>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <p className="muted" style={{ fontSize: 12 }}>
            推荐顺序：工艺包 → 补细纲 → 写章 → 摘要/钩子回收 → 声口体检。
          </p>
        </>
      )}
    </div>
  );
}
