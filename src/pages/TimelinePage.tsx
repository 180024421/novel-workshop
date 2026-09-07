import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  isHookDueThisChapter,
  isHookOverdue,
  loadHooksLedger,
  resolveHook,
  reopenHook,
  setHookDue,
  type HookItem,
} from "../lib/hooksLedger";
import { loadProjectProgress } from "../lib/projectProgress";
import { loadChapterBeatsText } from "../lib/volumes";
import { useApp } from "../state/AppContext";

type HookFilter = "open" | "resolved" | "overdue" | "all";

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

function normalizeDueInput(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^第\d+章$/.test(t)) return t;
  const n = t.match(/\d+/)?.[0];
  return n ? `第${n}章` : t;
}

export function TimelinePage() {
  const nav = useNavigate();
  const { project, join, chapterId, setChapterId, setChapterTitle, setVolumeId } = useApp();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [hooks, setHooks] = useState<HookItem[]>([]);
  const [filter, setFilter] = useState<HookFilter>("open");
  const [dueDraft, setDueDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");

  const reload = useCallback(async () => {
    if (!project || !window.moshu) return;
    const prog = await loadProjectProgress(project.root, join);
    const ledger = await loadHooksLedger(project.root, join);
    setHooks(ledger.items);
    const drafts: Record<string, string> = {};
    for (const h of ledger.items) {
      drafts[h.id] = h.dueChapter || "";
    }
    setDueDraft(drafts);

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
  }, [project, join]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filteredHooks = useMemo(() => {
    return hooks.filter((h) => {
      if (filter === "all") return true;
      if (filter === "open") return h.status === "open";
      if (filter === "resolved") return h.status === "resolved";
      if (filter === "overdue") return isHookOverdue(h, chapterId);
      return true;
    });
  }, [hooks, filter, chapterId]);

  function jumpToChapter(fromChapter: string) {
    const node = nodes.find((n) => n.id === fromChapter);
    setChapterId(fromChapter);
    setChapterTitle(node?.title || "未命名");
    if (node?.volumeId) setVolumeId(node.volumeId);
    nav("/app/chapter");
  }

  async function saveDue(h: HookItem) {
    if (!project) return;
    setBusyId(h.id);
    try {
      await setHookDue(project.root, join, h.id, normalizeDueInput(dueDraft[h.id] || ""));
      await reload();
    } finally {
      setBusyId("");
    }
  }

  async function toggleHook(h: HookItem) {
    if (!project) return;
    setBusyId(h.id);
    try {
      if (h.status === "open") await resolveHook(project.root, join, h.id);
      else await reopenHook(project.root, join, h.id);
      await reload();
    } finally {
      setBusyId("");
    }
  }

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
        <p className="muted">按章序查看场次与钩子；伏笔可设到期、筛选并跳转正文。</p>
      </div>

      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>伏笔看板</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            当前章 {chapterId} · 过期 = 仍开放且已过 due
          </span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["open", "开放"],
              ["overdue", "已过期"],
              ["resolved", "已回收"],
              ["all", "全部"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn ${filter === id ? "btn-primary" : "btn-ghost"} btn-compact`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {!filteredHooks.length && <p className="muted">该筛选下暂无钩子。</p>}
        {filteredHooks.map((h) => {
          const overdue = isHookOverdue(h, chapterId);
          const dueThis = isHookDueThisChapter(h, chapterId);
          return (
            <div key={h.id} className="list-card stack" style={{ gap: 8 }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <strong>
                  [{h.kind}/{h.fromChapter}] {h.text}
                </strong>
                <span className="badge-row">
                  <span className={`mini-badge ${h.status === "resolved" ? "ok" : ""}`}>
                    {h.status === "resolved" ? "已回收" : "开放"}
                  </span>
                  {dueThis && <span className="mini-badge ok">本章必收</span>}
                  {overdue && <span className="mini-badge">已过期</span>}
                </span>
              </div>
              {h.note?.trim() ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  备注：{h.note}
                </div>
              ) : null}
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label className="muted" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                  到期章
                  <input
                    style={{ width: 96 }}
                    value={dueDraft[h.id] ?? ""}
                    placeholder="第12章"
                    disabled={busyId === h.id}
                    onChange={(e) => setDueDraft((prev) => ({ ...prev, [h.id]: e.target.value }))}
                    onBlur={() => void saveDue(h)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveDue(h);
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={busyId === h.id}
                  onClick={() => void saveDue(h)}
                >
                  设到期
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={busyId === h.id}
                  onClick={() => void toggleHook(h)}
                >
                  {h.status === "open" ? "标记回收" : "重新开放"}
                </button>
                <button
                  type="button"
                  className="btn btn-compact"
                  onClick={() => jumpToChapter(h.fromChapter)}
                >
                  跳转正文
                </button>
              </div>
            </div>
          );
        })}
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
                    .map((h) => {
                      const mark =
                        h.status === "resolved"
                          ? "✓"
                          : isHookDueThisChapter(h, chapterId)
                            ? "★"
                            : "○";
                      const due = h.dueChapter ? `(due ${h.dueChapter})` : "";
                      return `${mark}${h.text}${due}`;
                    })
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
