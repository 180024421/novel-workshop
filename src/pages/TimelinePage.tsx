import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadHooksLedger, type HookItem } from "../lib/hooksLedger";
import { loadProjectProgress } from "../lib/projectProgress";
import { loadChapterBeatsText } from "../lib/volumes";
import { useApp } from "../state/AppContext";

type Node = {
  id: string;
  title: string;
  volumeId: string;
  hasBeats: boolean;
  hasChapter: boolean;
  words: number;
  scenes: string[];
  hooks: HookItem[];
};

function extractScenes(beats: string): string[] {
  return beats
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+[\.、)）]/.test(l) || /^[-*•]\s+\S/.test(l))
    .slice(0, 6)
    .map((l) => l.replace(/^[-*•\d.\s)）]+/, "").slice(0, 40));
}

export function TimelinePage() {
  const nav = useNavigate();
  const { project, join, setChapterId, setChapterTitle, setVolumeId } = useApp();
  const [nodes, setNodes] = useState<Node[]>([]);

  useEffect(() => {
    if (!project || !window.moshu) return;
    (async () => {
      const prog = await loadProjectProgress(project.root, join);
      const ledger = await loadHooksLedger(project.root, join);
      const list: Node[] = [];
      for (const row of prog.chapterRows) {
        const loaded = await loadChapterBeatsText({
          root: project.root,
          join,
          chapterId: row.id,
          volumeId: row.volumeId,
        });
        list.push({
          id: row.id,
          title: row.title,
          volumeId: row.volumeId || loaded.volumeId || "第1卷",
          hasBeats: row.hasBeats || Boolean(loaded.text.trim()),
          hasChapter: row.hasChapter,
          words: row.words || 0,
          scenes: extractScenes(loaded.text),
          hooks: ledger.items.filter((h) => h.fromChapter === row.id),
        });
      }
      setNodes(list);
    })();
  }, [project, join]);

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
        <h2 className="h2">时间线</h2>
        <p className="muted">按章序查看场次与钩子，点击跳转细纲或正文。</p>
      </div>
      {!nodes.length && (
        <div className="panel">
          <p className="muted">还没有章节。请先在「细纲」按卷写章节。</p>
          <Link className="btn" to="/app/beats">
            去细纲
          </Link>
        </div>
      )}
      <div className="timeline">
        {nodes.map((n, i) => (
          <div key={n.id} className="timeline-item">
            <div className="timeline-dot" />
            {i < nodes.length - 1 && <div className="timeline-line" />}
            <div className="panel stack" style={{ padding: 16 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {n.id} · {n.title}
                </strong>
                <span className="badge-row">
                  <span className={`mini-badge ${n.hasBeats ? "ok" : ""}`}>细纲</span>
                  <span className={`mini-badge ${n.hasChapter ? "ok" : ""}`}>
                    正文{n.words ? ` ${n.words}` : ""}
                  </span>
                </span>
              </div>
              {n.scenes.length > 0 && (
                <ul className="hook-list">
                  {n.scenes.map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ul>
              )}
              {n.hooks.length > 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  钩子：
                  {n.hooks
                    .map((h) => `${h.status === "resolved" ? "✓" : "○"}${h.text}`)
                    .join("；")}
                </div>
              )}
              <div className="row">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    setChapterId(n.id);
                    setChapterTitle(n.title);
                    if (n.volumeId) setVolumeId(n.volumeId);
                    nav("/app/beats");
                  }}
                >
                  细纲
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setChapterId(n.id);
                    setChapterTitle(n.title);
                    if (n.volumeId) setVolumeId(n.volumeId);
                    nav("/app/chapter");
                  }}
                >
                  正文
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
