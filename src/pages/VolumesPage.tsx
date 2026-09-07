import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { humanizeLlmError } from "../lib/gateway";
import { runVolumeCheck } from "../lib/volumeCheck";
import {
  loadProjectVolumes,
  reorderVolumeChaptersMd,
  volumeBeatsPath,
  type VolumeEntry,
} from "../lib/volumes";
import { useApp } from "../state/AppContext";

export function VolumesPage() {
  const nav = useNavigate();
  const {
    project,
    join,
    setVolumeId,
    setChapterId,
    setChapterTitle,
    volumeId,
    settings,
    providers,
  } = useApp();
  const [volumes, setVolumes] = useState<VolumeEntry[]>([]);
  const [selectedId, setSelectedId] = useState(volumeId || "第1卷");
  const [busy, setBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hint, setHint] = useState("");
  const [checkReport, setCheckReport] = useState("");

  const refresh = useCallback(async () => {
    if (!project || !window.moshu) return;
    const vols = await loadProjectVolumes({ root: project.root, join });
    setVolumes(vols);
    if (!vols.find((v) => v.id === selectedId) && vols[0]) {
      setSelectedId(vols[0].id);
    }
  }, [project, join, selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = volumes.find((v) => v.id === selectedId) || volumes[0] || null;

  async function moveChapter(index: number, dir: -1 | 1) {
    if (!project || !window.moshu || !selected) return;
    const next = index + dir;
    if (next < 0 || next >= selected.chapters.length) return;
    setBusy(true);
    setErr("");
    setHint("");
    try {
      const ids = selected.chapters.map((c) => c.id);
      const tmp = ids[index];
      ids[index] = ids[next];
      ids[next] = tmp;

      const beatsPath = await join(project.root, "beats", volumeBeatsPath(selected.id));
      const md = await window.moshu.readText(beatsPath);
      if (!md.trim()) {
        setErr("该卷还没有细纲文件，请先在「细纲」生成");
        return;
      }
      const rewritten = reorderVolumeChaptersMd(md, ids);
      await window.moshu.writeText(beatsPath, rewritten);
      setHint("已调整章节顺序");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function goChapter(ch: { id: string; title: string }) {
    if (!selected) return;
    setVolumeId(selected.id);
    setChapterId(ch.id);
    setChapterTitle(ch.title || "未命名");
    nav("/app/chapter");
  }

  function goBeats() {
    if (!selected) return;
    setVolumeId(selected.id);
    nav("/app/beats");
  }

  async function doVolumeCheck() {
    if (!project || !selected) return;
    setCheckBusy(true);
    setErr("");
    setHint("");
    setCheckReport("");
    try {
      const r = await runVolumeCheck({
        root: project.root,
        join,
        volumeId: selected.id,
        volumeTitle: selected.title,
        settings,
        providers,
      });
      setCheckReport(r.report);
      setHint(`卷体检报告已写入 continuity/volume-check-${selected.id}.md`);
    } catch (e) {
      setErr(humanizeLlmError(e));
    } finally {
      setCheckBusy(false);
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
    <div className="stack volumes-board">
      <div>
        <h2 className="h2">卷章管理</h2>
        <p className="muted">选择卷，上下调整章节在细纲中的顺序（不改章号，只改排列）。</p>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {volumes.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`btn ${v.id === selected?.id ? "btn-primary" : ""}`}
            disabled={busy || checkBusy}
            onClick={() => setSelectedId(v.id)}
          >
            {v.id}
            {v.title && v.title !== v.id ? ` · ${v.title}` : ""}
          </button>
        ))}
        {!volumes.length && <span className="muted">暂无卷细纲，请先写总纲并生成细纲</span>}
      </div>

      {selected && (
        <div className="panel">
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <strong>
              {selected.id}
              {selected.title && selected.title !== selected.id ? ` ${selected.title}` : ""}
            </strong>
            <button type="button" className="btn btn-ghost" onClick={goBeats}>
              去细纲
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (selected.chapters[0]) goChapter(selected.chapters[0]);
                else goBeats();
              }}
            >
              去正文
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || checkBusy}
              onClick={() => void doVolumeCheck()}
            >
              {checkBusy ? "卷体检中…" : "卷体检"}
            </button>
          </div>

          {!selected.chapters.length ? (
            <p className="muted">本卷还没有解析到章节。请先在「细纲」生成章节列表。</p>
          ) : (
            selected.chapters.map((ch, i) => (
              <div key={ch.id} className="volumes-chapter-row" style={{ cursor: "default" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {ch.id} {ch.title}
                  {ch.blurb ? <span className="muted"> — {ch.blurb}</span> : null}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={busy || checkBusy || i === 0}
                  onClick={() => void moveChapter(i, -1)}
                  title="上移"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={busy || checkBusy || i === selected.chapters.length - 1}
                  onClick={() => void moveChapter(i, 1)}
                  title="下移"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={busy || checkBusy}
                  onClick={() => goChapter(ch)}
                >
                  打开
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {hint && <p className="muted">{hint}</p>}
      {err && <p className="toast">{err}</p>}
      {checkReport && (
        <div className="panel stack">
          <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>体检报告预览</h3>
          <pre className="agent-md" style={{ whiteSpace: "pre-wrap", maxHeight: 420, overflow: "auto" }}>
            {checkReport}
          </pre>
        </div>
      )}
    </div>
  );
}
