import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyGuide, buildProjectChecklist } from "../components/EmptyGuide";
import { writeOneChapter } from "../lib/chapterWrite";
import { exportBook, exportVolumeZip, type ExportFormat } from "../lib/exportBook";
import { estimateCostCny, formatCny, loadPrices, pickPrice } from "../lib/costEstimate";
import {
  loadHooksLedger,
  resolveHook,
  reopenHook,
  type HookItem,
} from "../lib/hooksLedger";
import {
  clearJobQueue,
  loadJobQueue,
  removeJob,
  type PendingJob,
} from "../lib/jobQueue";
import { humanizeLlmError } from "../lib/gateway";
import {
  loadProjectProgress,
  type ProjectProgress,
} from "../lib/projectProgress";
import { useApp } from "../state/AppContext";

export function StatusPage() {
  const nav = useNavigate();
  const {
    project,
    join,
    setChapterId,
    setChapterTitle,
    providers,
    settings,
  } = useApp();
  const [prog, setProg] = useState<ProjectProgress | null>(null);
  const [hooks, setHooks] = useState<HookItem[]>([]);
  const [jobs, setJobs] = useState<PendingJob[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("qidian");
  const [costHint, setCostHint] = useState("");
  const [volSize, setVolSize] = useState(30);
  const [applyPlatformFormat, setApplyPlatformFormat] = useState(true);

  const reload = useCallback(async () => {
    if (!project) return;
    const p = await loadProjectProgress(project.root, join);
    setProg(p);
    const ledger = await loadHooksLedger(project.root, join);
    setHooks(ledger.items);
    const q = await loadJobQueue(project.root, join);
    setJobs(q.jobs || []);
    const prices = await loadPrices(join);
    const enabled = providers.find((pr) => pr.enabled && pr.apiKey.trim());
    const price = pickPrice(prices, enabled?.id);
    const left = Math.max(0, p.chapterTotal - p.chaptersDone);
    const est = estimateCostCny(4000 * left, 2500 * left, price.cnyPer1k);
    setCostHint(`剩余约 ${left} 章 · ${price.label} ${formatCny(est)}`);
  }, [project, join, providers]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function doExport() {
    if (!project) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await exportBook({
        root: project.root,
        join,
        title: project.project.title,
        format,
        applyPlatformFormat,
      });
      setMsg(`已导出 ${r.chapters} 章 / ${r.words} 字 → ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHook(h: HookItem) {
    if (!project) return;
    if (h.status === "open") await resolveHook(project.root, join, h.id);
    else await reopenHook(project.root, join, h.id);
    await reload();
  }

  async function retryJob(job: PendingJob) {
    if (!project) return;
    setBusy(true);
    setErr("");
    try {
      if (job.kind === "chapter") {
        await writeOneChapter({
          root: project.root,
          join,
          chapterId: job.chapterId,
          chapterTitle: job.chapterTitle,
          settings,
          providers,
          targetWords: settings.defaultChapterWords ?? 2500,
        });
      }
      await removeJob(project.root, join, job.id);
      setMsg(`已重试完成 ${job.chapterId}`);
      await reload();
    } catch (e) {
      setErr(humanizeLlmError(e));
    } finally {
      setBusy(false);
    }
  }

  async function doExportZip() {
    if (!project) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await exportVolumeZip({
        root: project.root,
        join,
        title: project.project.title,
        format,
        chaptersPerVolume: volSize,
      });
      setMsg(r.message);
      if (r.filePath) void window.moshu?.showItemInFolder?.(r.filePath);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function retryAll() {
    if (!project || !jobs.length) return;
    setBusy(true);
    setErr("");
    let ok = 0;
    for (const job of [...jobs]) {
      try {
        if (job.kind === "chapter") {
          await writeOneChapter({
            root: project.root,
            join,
            chapterId: job.chapterId,
            chapterTitle: job.chapterTitle,
            settings,
            providers,
            targetWords: settings.defaultChapterWords ?? 2500,
          });
        }
        await removeJob(project.root, join, job.id);
        ok++;
      } catch (e) {
        setErr(humanizeLlmError(e));
        break;
      }
    }
    setMsg(`已重试完成 ${ok} 项`);
    await reload();
    setBusy(false);
  }

  if (!project) {
    return (
      <div className="panel">
        <Link to="/">回首页</Link>
      </div>
    );
  }

  const openHooks = hooks.filter((h) => h.status === "open");
  const resolvedHooks = hooks.filter((h) => h.status === "resolved");

  return (
    <div className="stack">
      <div>
        <h2 className="h2">进度与导出</h2>
        <p className="muted">进度、钩子回收、待重试队列、平台导出。</p>
      </div>

      {(!prog?.hasOutline ||
        !(prog.hasBible || prog.hasSeed) ||
        prog.beatsDone === 0 ||
        !prog.chapterRows.some((r) => r.hasChapter)) && (
        <EmptyGuide
          title="开书清单"
          steps={buildProjectChecklist({
            hasBible: Boolean(prog?.hasBible || prog?.hasSeed),
            hasOutline: Boolean(prog?.hasOutline),
            hasBeats: (prog?.beatsDone || 0) > 0,
            hasChapter1: Boolean(
              prog?.chapterRows.find((r) => r.id === "第1章")?.hasChapter ||
                prog?.chapterRows[0]?.hasChapter
            ),
          }).map((s) =>
            s.done ? `✓ ${s.text}` : { text: s.text, to: s.to }
          )}
          primaryTo="/app/idea"
          primaryLabel="从设定开始"
        />
      )}

      <div className="panel stack">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">设定</div>
            <div className="stat-value">{prog?.hasBible || prog?.hasSeed ? "有" : "空"}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">总纲</div>
            <div className="stat-value">{prog?.hasOutline ? `${prog.chapterTotal} 章` : "未识别"}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">细纲</div>
            <div className="stat-value">
              {prog ? `${prog.beatsDone}/${prog.chapterTotal || "—"}` : "…"}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">正文</div>
            <div className="stat-value">
              {prog ? `${prog.chaptersDone}/${prog.chapterTotal || "—"}` : "…"}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">总字数</div>
            <div className="stat-value">{prog ? prog.wordsTotal.toLocaleString() : "…"}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">未解钩子</div>
            <div className="stat-value">{openHooks.length}</div>
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {costHint}
        </p>

        <div className="field">
          <label>导出格式</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="qidian">起点风格 TXT</option>
            <option value="tomato">番茄风格 TXT</option>
            <option value="feilu">飞卢风格 TXT</option>
            <option value="plain">纯文本</option>
            <option value="markdown">Markdown</option>
            <option value="epub">EPUB 电子书</option>
            <option value="docx">Word DOCX</option>
          </select>
        </div>
        {(format === "qidian" || format === "tomato" || format === "plain") && (
          <label className="check-row" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={applyPlatformFormat}
              onChange={(e) => setApplyPlatformFormat(e.target.checked)}
            />
            应用平台排版（段间空行 / 番茄段首空格）并附加字数脚注
          </label>
        )}
        <div className="field">
          <label>分卷大小（章/卷）</label>
          <input
            type="number"
            min={5}
            max={100}
            value={volSize}
            onChange={(e) => setVolSize(Number(e.target.value) || 30)}
          />
        </div>

        <div className="row">
          <button className="btn" onClick={() => void reload()}>
            刷新
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void doExport()}>
            {busy
              ? "导出中…"
              : format === "epub" || format === "docx"
                ? `导出 ${format.toUpperCase()}`
                : "导出全书 TXT"}
          </button>
          <button
            className="btn"
            disabled={busy || format === "epub" || format === "docx"}
            title={format === "epub" || format === "docx" ? "分卷 Zip 仅支持文本格式" : undefined}
            onClick={() => void doExportZip()}
          >
            分卷 Zip
          </button>
          <button className="btn" onClick={() => nav("/app/batch")}>
            批量写正文
          </button>
          <button className="btn" onClick={() => nav("/app/revise")}>
            改稿队列
          </button>
          <button className="btn" onClick={() => nav("/app/timeline")}>
            时间线
          </button>
        </div>
        {msg && <p className="ok-text">{msg}</p>}
        {err && <p className="toast">{err}</p>}
      </div>

      {jobs.length > 0 && (
        <div className="panel stack retry-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontFamily: "var(--font-brand)", color: "var(--danger)" }}>
              待重试队列（{jobs.length}）
            </h3>
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={() => void retryAll()}>
                全部重试
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => void clearJobQueue(project.root, join).then(reload)}
              >
                清空
              </button>
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            网络抖动或限流导致的失败会进这里。点「全部重试」可一次跑完。
          </p>
          {jobs.map((j) => (
            <div key={j.id} className="list-card">
              <strong>
                {j.kind === "chapter" ? "写正文" : "拆细纲"} · {j.chapterId} {j.chapterTitle}
              </strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {j.error.slice(0, 120)}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn-primary" disabled={busy} onClick={() => void retryJob(j)}>
                  重试
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => void removeJob(project.root, join, j.id).then(reload)}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel stack">
        <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>钩子账本</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          勾选即标记「已回收」，写下一章时不再注入。
        </p>
        {!hooks.length && <p className="muted">暂无钩子。写完章后点「抽钩子」。</p>}
        {openHooks.map((h) => (
          <label key={h.id} className="check-row">
            <input type="checkbox" checked={false} onChange={() => void toggleHook(h)} />
            <span>
              [{h.kind}/{h.fromChapter}] {h.text}
            </span>
          </label>
        ))}
        {resolvedHooks.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: 12 }}>
              已回收
            </div>
            {resolvedHooks.map((h) => (
              <label key={h.id} className="check-row">
                <input type="checkbox" checked onChange={() => void toggleHook(h)} />
                <span style={{ textDecoration: "line-through", opacity: 0.7 }}>
                  [{h.kind}/{h.fromChapter}] {h.text}
                </span>
              </label>
            ))}
          </>
        )}
      </div>

      <div className="panel stack">
        <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>分章状态</h3>
        <div className="stack" style={{ maxHeight: 400, overflow: "auto" }}>
          {prog?.chapterRows.map((r) => (
            <div
              key={r.id}
              className="list-card"
              role="button"
              tabIndex={0}
              onClick={() => {
                setChapterId(r.id);
                setChapterTitle(r.title);
                nav(r.hasChapter ? "/app/chapter" : "/app/beats");
              }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {r.id} {r.title}
                </strong>
                <span className="badge-row">
                  <span className={`mini-badge ${r.hasBeats ? "ok" : ""}`}>细纲</span>
                  <span className={`mini-badge ${r.hasChapter ? "ok" : ""}`}>
                    正文{r.words ? ` ${r.words}` : ""}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
