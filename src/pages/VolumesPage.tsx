import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { confirmAction, promptText } from "../lib/confirm";
import { humanizeLlmError } from "../lib/gateway";
import { runVolumeCheck } from "../lib/volumeCheck";
import {
  addChapterToVolume,
  bootstrapVolumeBeatsFromChapters,
  createNextVolume,
  loadProjectVolumes,
  removeChapterListLine,
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
  const [newTitle, setNewTitle] = useState("");

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
        setErr("该卷还没有细纲文件，请先新建卷或从章文件生成目录");
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

  async function doAddVolume() {
    if (!project) return;
    setBusy(true);
    setErr("");
    try {
      const r = await createNextVolume({ root: project.root, join });
      setSelectedId(r.volumeId);
      setVolumeId(r.volumeId);
      setHint(`已新建 ${r.volumeId}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doAddChapter() {
    if (!project || !selected) return;
    const title = (newTitle.trim() || await promptText("新章标题", "未命名") || "").trim();
    if (!title) return;
    setBusy(true);
    setErr("");
    try {
      const r = await addChapterToVolume({
        root: project.root,
        join,
        volumeId: selected.id,
        title,
      });
      setNewTitle("");
      setChapterId(r.chapterId);
      setChapterTitle(r.title);
      setVolumeId(selected.id);
      setHint(`已新建 ${r.chapterId} ${r.title}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doRemoveFromList(chapterId: string) {
    if (!project || !window.moshu || !selected) return;
    if (
      !(await confirmAction(
        `将 ${chapterId} 从「${selected.id}」目录移除？\n正文文件仍保留在 chapters/。`
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      const beatsPath = await join(project.root, "beats", volumeBeatsPath(selected.id));
      const md = await window.moshu.readText(beatsPath);
      await window.moshu.writeText(beatsPath, removeChapterListLine(md, chapterId));
      setHint(`已从目录移除 ${chapterId}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doBootstrap() {
    if (!project) return;
    setBusy(true);
    setErr("");
    try {
      const r = await bootstrapVolumeBeatsFromChapters({
        root: project.root,
        join,
        overwrite: false,
      });
      if (!r.chapterCount) {
        setErr("chapters/ 下没有可识别的章节文件");
        return;
      }
      setSelectedId(r.volumesWritten[0] || "第1卷");
      setHint(`已从章文件生成目录：${r.chapterCount} 章 → ${r.volumesWritten.join("、")}`);
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
        <p className="muted">新建卷/章、调整顺序；导入书可一键从章文件生成目录（不依赖 AI）。</p>
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
        <button type="button" className="btn" disabled={busy} onClick={() => void doAddVolume()}>
          +新建卷
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void doBootstrap()}>
          从章文件生成目录
        </button>
        {!volumes.length && (
          <span className="muted">暂无卷细纲 — 可点「从章文件生成目录」或「+新建卷」</span>
        )}
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

          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="新章标题"
              style={{ flex: 1, minWidth: 120 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doAddChapter();
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-compact"
              disabled={busy}
              onClick={() => void doAddChapter()}
            >
              +新建章
            </button>
          </div>

          {!selected.chapters.length ? (
            <p className="muted">本卷还没有章节。可「+新建章」或「从章文件生成目录」。</p>
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
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  disabled={busy || checkBusy}
                  onClick={() => void doRemoveFromList(ch.id)}
                  title="仅从目录移除，保留正文文件"
                >
                  移出目录
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
