import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  computeBookHealth,
  projectHasCraftRules,
  type BookHealthReport,
} from "../lib/bookHealth";
import {
  parseConsistencyIssues,
  runConsistencyCheck,
  type ConsistencyIssue,
} from "../lib/consistencyCheck";
import { humanizeLlmError } from "../lib/gateway";
import { useApp } from "../state/AppContext";

export function HealthPage() {
  const nav = useNavigate();
  const { project, join, settings, providers, llmReady, setChapterId } = useApp();
  const [report, setReport] = useState<BookHealthReport | null>(null);
  const [hasCraft, setHasCraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [consistencyReport, setConsistencyReport] = useState("");
  const [issues, setIssues] = useState<ConsistencyIssue[]>([]);
  const [consistBusy, setConsistBusy] = useState(false);

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
      if (window.moshu) {
        try {
          const path = await join(project.root, "continuity", "consistency-check.md");
          const prev = await window.moshu.readText(path);
          if (prev.trim()) {
            setConsistencyReport(prev);
            setIssues(parseConsistencyIssues(prev));
          }
        } catch {
          /* none */
        }
      }
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

  async function runConsistency() {
    if (!project) return;
    if (!llmReady) {
      setErr("请先配置可用模型");
      return;
    }
    setConsistBusy(true);
    setErr("");
    try {
      const r = await runConsistencyCheck({
        root: project.root,
        join,
        settings,
        providers,
      });
      setConsistencyReport(r.report);
      setIssues(r.issues);
      if (r.missingSummaries > 0) {
        setErr("摘要不足，请先到「章摘要」补齐后再检");
      }
    } catch (e) {
      setErr(humanizeLlmError(e));
    } finally {
      setConsistBusy(false);
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
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 className="h2">本书健康分</h2>
          <p className="muted">细纲 · 钩子 · 工艺 · 摘要 · 过审 — 质检收成一页。</p>
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

      {report && report.dimensions.find((d) => d.id === "beats" && d.score < 8) && (
        <div className="panel">
          <p style={{ margin: 0 }}>
            细纲覆盖偏低。导入书可到{" "}
            <Link to="/app/volumes">卷章管理</Link> 点「从章文件生成目录」。
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

          <div className="panel stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: 0 }}>跨章一致性</h3>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                  基于章摘要 / 实体 / 钩子做一次诊断（摘要不足时请先补）。
                </p>
              </div>
              <button
                type="button"
                className="btn btn-compact"
                disabled={consistBusy || !llmReady}
                onClick={() => void runConsistency()}
              >
                {consistBusy ? "检查中…" : "运行检查"}
              </button>
            </div>
            {issues.length > 0 && (
              <div className="stack">
                {issues.map((it, i) => (
                  <div key={i} className="muted" style={{ fontSize: 13 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      onClick={() => {
                        if (/第\d+章/.test(it.chapterId)) {
                          setChapterId(it.chapterId);
                          nav("/app/chapter");
                        }
                      }}
                    >
                      {it.chapterId}
                    </button>{" "}
                    · {it.kind} · {it.detail}
                  </div>
                ))}
              </div>
            )}
            {consistencyReport && (
              <pre className="agent-md" style={{ maxHeight: 280, overflow: "auto", fontSize: 12 }}>
                {consistencyReport}
              </pre>
            )}
            {!consistencyReport && (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                尚无报告。摘要不足时可先去 <Link to="/app/summaries">章摘要</Link>。
              </p>
            )}
          </div>

          <p className="muted" style={{ fontSize: 12 }}>
            推荐顺序：工艺包 → 补细纲 → 写章 → 摘要/钩子回收 → 过审 / 一致性 / 声口。
          </p>
        </>
      )}
    </div>
  );
}
