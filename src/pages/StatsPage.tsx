import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatCny } from "../lib/costEstimate";
import { loadProjectProgress, type ProjectProgress } from "../lib/projectProgress";
import { computeRhythmStats, type RhythmStats } from "../lib/rhythm";
import {
  buildWeeklyReport,
  calcWritingStreak,
  getRecentUsage,
  getTodayUsage,
  loadUsage,
  type DayUsage,
  type WeeklyReport,
} from "../lib/usageLedger";
import { useApp } from "../state/AppContext";

type DayRow = { date: string; words: number; costCny: number };

export function StatsPage() {
  const { project, join, settings } = useApp();
  const [today, setToday] = useState<DayUsage>({ words: 0, costCny: 0 });
  const [days7, setDays7] = useState<DayRow[]>([]);
  const [days30, setDays30] = useState<DayRow[]>([]);
  const [streak, setStreak] = useState(0);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [prog, setProg] = useState<ProjectProgress | null>(null);
  const [rhythm, setRhythm] = useState<RhythmStats | null>(null);

  useEffect(() => {
    void (async () => {
      setToday(await getTodayUsage());
      setDays7(await getRecentUsage(7));
      setDays30(await getRecentUsage(30));
      const store = await loadUsage();
      setStreak(calcWritingStreak(store.days));
      setWeekly(buildWeeklyReport(store, 7));
      if (project && window.moshu) {
        try {
          const p = await loadProjectProgress(project.root, join);
          setProg(p);
          const done = p.chapterRows.filter((r) => r.hasChapter && r.words > 0).slice(-15);
          const files = await window.moshu.listDir(await join(project.root, "chapters"));
          const sampleBodies: { chapterId: string; body: string }[] = [];
          for (const row of done) {
            const hit = files.find(
              (f) => f.name.startsWith(`${row.id}_`) && f.name.endsWith(".md")
            );
            if (!hit) continue;
            try {
              const body = await window.moshu.readText(hit.path);
              sampleBodies.push({ chapterId: row.id, body });
            } catch {
              /* skip */
            }
          }
          setRhythm(
            await computeRhythmStats({
              root: project.root,
              join,
              prog: p,
              sampleBodies,
            })
          );
        } catch {
          setProg(null);
          setRhythm(null);
        }
      } else {
        setProg(null);
        setRhythm(null);
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
        <p className="muted">日字数、成本、连续写作天数、本地周报与节奏仪表盘。</p>
      </div>

      {weekly && (
        <div className="panel stack">
          <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>近 7 日周报</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {weekly.from} ~ {weekly.to} · 活跃 {weekly.activeDays} 天
          </p>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">周字数</div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {weekly.words.toLocaleString()}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">周费用</div>
              <div className="stat-value" style={{ fontSize: 18 }}>
                {formatCny(weekly.costCny).replace(/^≈\s*/, "")}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">写章成功</div>
              <div className="stat-value">{weekly.writeOk}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">失败率</div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {weekly.writeOk + weekly.writeFail > 0 ? `${weekly.failRate}%` : "—"}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                失败 {weekly.writeFail} 次
              </div>
            </div>
          </div>
        </div>
      )}

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
        {rhythm && (
          <div className="stat-card">
            <div className="stat-label">钩子闭合率</div>
            <div className="stat-value" style={{ fontSize: 20 }}>
              {Math.round(rhythm.hookCloseRatio * 100)}%
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              开 {rhythm.openHooks} / 闭 {rhythm.resolvedHooks}
            </div>
          </div>
        )}
      </div>

      {rhythm && (
        <div className="panel stack">
          <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>节奏仪表盘</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            字数分桶基于全书已写章；标签粗扫近 {Math.min(15, rhythm.chaptersDone || 0)} 章正文。
          </p>
          <div className="stats-bars">
            {rhythm.wordBuckets.map((b) => (
              <div key={b.label} className="stats-bar-row" title={`${b.count} 章`}>
                <span className="stats-bar-label">{b.label}</span>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill"
                    style={{
                      width: `${Math.round(
                        (b.count / Math.max(1, rhythm.chaptersDone)) * 100
                      )}%`,
                    }}
                  />
                </div>
                <span className="stats-bar-num">{b.count}</span>
              </div>
            ))}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
            {rhythm.tagCounts.map((t) => (
              <span key={t.tag} className="mini-badge ok">
                {t.tag} {t.count}
              </span>
            ))}
          </div>
        </div>
      )}

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
