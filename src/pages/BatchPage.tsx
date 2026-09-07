import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  clearBatchSession,
  loadBatchSession,
  sessionProgressLabel,
  type BatchSession,
} from "../lib/batchSession";
import {
  runBatchWrite,
  type BatchProgress,
  type BatchRunMode,
  type WritePreset,
} from "../lib/chapterWrite";
import { estimateCostCny, formatCny, loadPrices, pickPrice } from "../lib/costEstimate";
import { confirmAction, isAbortError } from "../lib/confirm";
import { humanizeLlmError } from "../lib/gateway";
import type { ChapterEntry } from "../lib/prompts";
import { addUsage } from "../lib/usageLedger";
import { loadProjectVolumes } from "../lib/volumes";
import { useApp } from "../state/AppContext";

export function BatchPage() {
  const nav = useNavigate();
  const { project, settings, join, providers, llmReady } = useApp();
  const [chapters, setChapters] = useState<ChapterEntry[]>([]);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(3);
  const [skipExisting, setSkipExisting] = useState(true);
  const [targetWords, setTargetWords] = useState(settings.defaultChapterWords ?? 2500);
  const [delayMs, setDelayMs] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [err, setErr] = useState("");
  const [costHint, setCostHint] = useState("");
  const [toTray, setToTray] = useState(true);
  const [presetOverride, setPresetOverride] = useState<"" | WritePreset>("");
  const [session, setSession] = useState<BatchSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function refreshSession() {
    if (!project) return;
    const s = await loadBatchSession(project.root, join);
    setSession(s);
    if (s) {
      setFrom(s.from);
      setTo(s.to);
      setSkipExisting(s.skipExisting);
      setTargetWords(s.targetWords);
      setDelayMs(s.delayMs);
      setPresetOverride(s.preset);
    }
  }

  useEffect(() => {
    if (!project || !window.moshu) return;
    void refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, join]);

  useEffect(() => {
    if (!project || !window.moshu) return;
    (async () => {
      const vols = await loadProjectVolumes({ root: project.root, join });
      const chs = vols.flatMap((v) => v.chapters);
      setChapters(chs);
      const prices = await loadPrices(join);
      const enabled = providers.find((p) => p.enabled && p.apiKey.trim());
      const price = pickPrice(prices, enabled?.id);
      const n = Math.max(0, to - from + 1);
      const est = estimateCostCny(4000 * n, targetWords * n, price.cnyPer1k);
      setCostHint(`${n} 章粗估 ${formatCny(est)}（${price.label}）`);
    })();
  }, [project, join, from, to, targetWords, providers]);

  async function start(mode: BatchRunMode = "new") {
    if (!project) return;
    if (!llmReady) {
      nav("/setup");
      return;
    }
    if (!chapters.length) {
      setErr("细纲里还没有章节（请先在「细纲」写本卷章节列表）");
      return;
    }
    if (
      mode === "new" &&
      !skipExisting &&
      !(await confirmAction("未勾选「跳过已有」，已有正文的章节会被覆盖。确定继续？"))
    ) {
      return;
    }
    if (mode !== "new" && !session) {
      setErr("没有可续跑的批量会话");
      return;
    }
    if (mode === "continue" && session && session.pending.length === 0) {
      setErr("没有待写章节（可「只重试失败」或清空后重开）");
      return;
    }
    if (mode === "retryFailed" && session && session.failed.length === 0) {
      setErr("没有失败章节可重试");
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setErr("");
    setProgress({ current: "", done: 0, total: 0, log: [], wordsWritten: 0 });
    if (toTray && window.moshu?.minimizeToTray) {
      await window.moshu.minimizeToTray();
    }
    try {
      const result = await runBatchWrite({
        root: project.root,
        join,
        chapters,
        job: { from, to, skipExisting, targetWords, delayMs },
        settings,
        providers,
        signal: ac.signal,
        writePreset: presetOverride || undefined,
        mode,
        session: mode === "new" ? null : session,
        onProgress: (p) => {
          setProgress({ ...p, log: [...p.log] });
          if (p.session) setSession(p.session);
        },
      });
      setProgress(result);
      if (result.session) setSession(result.session);
      const prices = await loadPrices(join);
      const enabled = providers.find((p) => p.enabled && p.apiKey.trim());
      const price = pickPrice(prices, enabled?.id);
      const written = result.done || 0;
      const words = result.wordsWritten || written * targetWords;
      const cost = estimateCostCny(4000 * written, words, price.cnyPer1k);
      if (words > 0 || written > 0) await addUsage({ words, costCny: cost });
      await window.moshu?.notify?.({
        title: "大帅墨枢",
        body: `批量写完成：${result.done}/${result.total} 章 · 实写约 ${words.toLocaleString()} 字`,
      });
      await window.moshu?.showMainWindow?.();
      await refreshSession();
    } catch (e) {
      if (!isAbortError(e)) {
        setErr(humanizeLlmError(e));
        await window.moshu?.notify?.({
          title: "大帅墨枢 · 批量写中断",
          body: humanizeLlmError(e).slice(0, 120),
        });
        await window.moshu?.showMainWindow?.();
      }
      await refreshSession();
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function clearSession() {
    if (!project) return;
    if (!(await confirmAction("清空批量会话记录？未完成章节不会被删除。"))) return;
    await clearBatchSession(project.root, join);
    setSession(null);
    setProgress(null);
  }

  if (!project) {
    return (
      <div className="panel">
        <Link to="/">回首页</Link>
      </div>
    );
  }

  const hasPending = Boolean(session && session.pending.length > 0);
  const hasFailed = Boolean(session && session.failed.length > 0);

  return (
    <div className="stack">
      <div>
        <h2 className="h2">批量写正文</h2>
        <p className="muted">从第 N 章写到第 M 章。可跳过已有、可停止后续跑。失败自动记入会话以便重试。</p>
      </div>

      <div className="panel stack">
        <div className="row">
          <div className="field" style={{ width: 120 }}>
            <label>从第</label>
            <input
              type="number"
              min={1}
              value={from}
              disabled={busy}
              onChange={(e) => setFrom(Number(e.target.value) || 1)}
            />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label>到第</label>
            <input
              type="number"
              min={1}
              value={to}
              disabled={busy}
              onChange={(e) => setTo(Number(e.target.value) || 1)}
            />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>每章字数</label>
            <input
              type="number"
              value={targetWords}
              disabled={busy}
              onChange={(e) => setTargetWords(Number(e.target.value) || 2500)}
            />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>章间隔(ms)</label>
            <input
              type="number"
              value={delayMs}
              disabled={busy}
              onChange={(e) => setDelayMs(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>预设</label>
            <select
              value={presetOverride}
              disabled={busy}
              onChange={(e) => setPresetOverride(e.target.value as "" | WritePreset)}
            >
              <option value="">默认（{settings.writePreset === "fast" ? "快速" : "质量"}）</option>
              <option value="quality">质量</option>
              <option value="fast">快速</option>
            </select>
          </div>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={skipExisting}
            onChange={(e) => setSkipExisting(e.target.checked)}
            disabled={busy}
          />
          跳过已有正文（中断后续跑请勾选）
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={toTray}
            onChange={(e) => setToTray(e.target.checked)}
            disabled={busy}
          />
          开始后最小化到托盘，完成后系统通知
        </label>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          细纲识别 {chapters.length} 章 · {costHint}
        </p>

        {session && (
          <div className="stack" style={{ gap: 6 }}>
            <p className="ok-text" style={{ margin: 0 }}>
              会话：{sessionProgressLabel(session)}
              {session.updatedAt ? ` · 更新于 ${session.updatedAt.slice(0, 16).replace("T", " ")}` : ""}
            </p>
            {session.failed.length > 0 && (
              <div className="stream-box" style={{ maxHeight: 120, minHeight: 40 }}>
                {session.failed.map((f) => `${f.chapterId}: ${f.error}`).join("\n")}
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void start("new")}>
            {busy ? `写作中 ${progress?.current || ""}…` : "开始批量写"}
          </button>
          <button
            className="btn"
            disabled={busy || !hasPending}
            onClick={() => void start("continue")}
          >
            继续未完成
          </button>
          <button
            className="btn"
            disabled={busy || !hasFailed}
            onClick={() => void start("retryFailed")}
          >
            只重试失败
          </button>
          <button className="btn btn-ghost" disabled={busy || !session} onClick={() => void clearSession()}>
            清空会话
          </button>
          {busy && (
            <button className="btn btn-danger" type="button" onClick={() => abortRef.current?.abort()}>
              停止
            </button>
          )}
          <button className="btn btn-ghost" disabled={busy} onClick={() => nav("/app/beats")}>
            回细纲
          </button>
        </div>
        {progress && (
          <div className="stack">
            <p className="ok-text">
              进度 {progress.done}/{progress.total}
              {progress.wordsWritten ? ` · 实写 ${progress.wordsWritten.toLocaleString()} 字` : ""}
              {progress.current ? ` · 当前 ${progress.current}` : ""}
            </p>
            <div className="stream-box" style={{ maxHeight: 280, minHeight: 120 }}>
              {progress.log.join("\n")}
            </div>
          </div>
        )}
        {err && (
          <p className="toast">
            {err}{" "}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "2px 8px", fontSize: 12 }}
              onClick={() => void navigator.clipboard.writeText(err)}
            >
              复制错误
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
