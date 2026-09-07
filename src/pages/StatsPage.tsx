import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatCny } from "../lib/costEstimate";
import { loadProjectProgress, type ProjectProgress } from "../lib/projectProgress";
import {
  calcWritingStreak,
  getRecentUsage,
  getTodayUsage,
  loadUsage,
  type DayUsage,
} from "../lib/usageLedger";
import { useApp } from "../state/AppContext";

type DayRow = { date: string; words: number; costCny: number };

export function StatsPage() {
  const { project, join, settings } = useApp();
  const [today, setToday] = useState<DayUsage>({ words: 0, costCny: 0 });
  const [days7, setDays7] = useState<DayRow[]>([]);
  const [days30, setDays30] = useState<DayRow[]>([]);
  const [streak, setStreak] = useState(0);
  const [prog, setProg] = useState<ProjectProgress | null>(null);

  useEffect(() => {
    void (async () => {
      setToday(await getTodayUsage());
      setDays7(await getRecentUsage(7));
      setDays30(await getRecentUsage(30));
      const store = await loadUsage();
      setStreak(calcWritingStreak(store.days));
      if (project) {
        try {
          setProg(await loadProjectProgress(project.root, join));
        } catch {
          setProg(null);
        }
      } else {
        setProg(null);
      }
    })();
  }, [project, join]);

  const avgChapterWords = useMemo(() => {
    if (!prog?.chaptersDone) return 0;
    const done = prog.chapterRows.filter((r) => r.hasChapter && r.words > 0);
    if (!done.length) return 0;
    return Math.round(done.reduce((s, r) => s + r.words, 0) / done.length);
  }, [prog]);

  const max7 = Math.max(1, ...days7.map((d) => d.words));
  const max30 = Math.max(1, ...days30.map((d) => d.words));
  const maxCost7 = Math.max(0.01, ...days7.map((d) => d.costCny));
  const goal = settings.dailyWordGoal || 2000;

  if (!project) {
    return (
      <div className="panel">
        <Link to="/">回首页</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h2 className="h2">写作统计</h2>
        <p className="muted">日字数、成本、连续写作天数与章均字数（本地账本）。</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">今日字数</div>
          <div className="stat-value">{today.words.toLocaleString()}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            目标 {goal.toLocaleString()}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">今日费用</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {formatCny(today.costCny).replace(/^≈\s*/, "")}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">连续写作</div>
          <div className="stat-value">{streak}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            天
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">章均字数</div>
          <div className="stat-value">{avgChapterWords.toLocaleString()}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            已写 {prog?.chaptersDone ?? 0}/{prog?.chapterTotal ?? 0} 章
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">全书字数</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {(prog?.wordsTotal ?? 0).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="panel stack">
        <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>近 7 日字数</h3>
        <div className="stats-bars">
          {days7.map((d) => (
            <div key={d.date} className="stats-bar-row" title={`${d.words} 字`}>
              <span className="stats-bar-label">{d.date}</span>
              <div className="stats-bar-track">
                <div
                  className="stats-bar-fill"
                  style={{ width: `${Math.round((d.words / max7) * 100)}%` }}
                />
              </div>
              <span className="stats-bar-num">{d.words.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel stack">
        <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>近 7 日费用</h3>
        <div className="stats-bars">
          {days7.map((d) => (
            <div key={`c-${d.date}`} className="stats-bar-row" title={formatCny(d.costCny)}>
              <span className="stats-bar-label">{d.date}</span>
              <div className="stats-bar-track">
                <div
                  className="stats-bar-fill cost"
                  style={{ width: `${Math.round((d.costCny / maxCost7) * 100)}%` }}
                />
              </div>
              <span className="stats-bar-num">
                {formatCny(d.costCny).replace(/^≈\s*/, "")}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel stack">
        <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>近 30 日字数</h3>
        <div className="stats-bars stats-bars-dense">
          {days30.map((d) => (
            <div key={d.date} className="stats-bar-row" title={`${d.date} · ${d.words} 字`}>
              <span className="stats-bar-label">{d.date.slice(3)}</span>
              <div className="stats-bar-track">
                <div
                  className="stats-bar-fill"
                  style={{ width: `${Math.round((d.words / max30) * 100)}%` }}
                />
              </div>
              <span className="stats-bar-num muted">{d.words || ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
