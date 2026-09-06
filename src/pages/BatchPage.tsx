import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { runBatchWrite, type BatchProgress } from "../lib/chapterWrite";
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
  const abortRef = useRef<AbortController | null>(null);

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

  async function start() {
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
      !skipExisting &&
      !confirmAction("未勾选「跳过已有」，已有正文的章节会被覆盖。确定继续？")
    ) {
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
        onProgress: (p) => setProgress({ ...p, log: [...p.log] }),
      });
      setProgress(result);
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
    } catch (e) {
      if (!isAbortError(e)) {
        setErr(humanizeLlmError(e));
        await window.moshu?.notify?.({
          title: "大帅墨枢 · 批量写中断",
          body: humanizeLlmError(e).slice(0, 120),
        });
        await window.moshu?.showMainWindow?.();
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
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
        <h2 className="h2">批量写正文</h2>
        <p className="muted">从第 N 章写到第 M 章。可跳过已有、可停止后续跑。失败自动重试。</p>
      </div>

      <div className="panel stack">
        <div className="row">
          <div className="field" style={{ width: 120 }}>
            <label>从第</label>
            <input type="number" min={1} value={from} onChange={(e) => setFrom(Number(e.target.value) || 1)} />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label>到第</label>
            <input type="number" min={1} value={to} onChange={(e) => setTo(Number(e.target.value) || 1)} />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>每章字数</label>
            <input
              type="number"
              value={targetWords}
              onChange={(e) => setTargetWords(Number(e.target.value) || 2500)}
            />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label>章间隔(ms)</label>
            <input type="number" value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value) || 0)} />
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
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
            {busy ? `写作中 ${progress?.current || ""}…` : "开始批量写"}
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
