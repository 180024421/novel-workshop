import { useEffect, useRef, useState } from "react";
import { backupChapter, listBackups, restoreBackup, type BackupMeta } from "../lib/backup";
import { alignBeatsToBody, type BeatAlignRow } from "../lib/beatsAlign";
import { writeOneChapter, type WritePreset } from "../lib/chapterWrite";
import { loadCharactersMarkdown } from "../lib/characters";
import { confirmOverwrite, isAbortError } from "../lib/confirm";
import { estimateCostCny, formatCny, loadPrices, pickPrice } from "../lib/costEstimate";
import { loadDraftB, saveDraftB, type DraftSlot } from "../lib/dualDraft";
import { chatCompletion, humanizeLlmError } from "../lib/gateway";
import {
  extractAndSaveHooks,
  formatOpenHooksForPrompt,
  loadHooksLedger,
  resolveHook,
  reopenHook,
  resolveHooksBeforeChapter,
  type HookItem,
} from "../lib/hooksLedger";
import { enqueueJob, shouldEnqueue } from "../lib/jobQueue";
import { pickPrevChapterFile } from "../lib/chapterNav";
import { syncChapterFileName } from "../lib/chapterFiles";
import { formatKbForPrompt, retrieveChunks } from "../lib/kb";
import { checkLicense } from "../lib/license";
import { countTextWords } from "../lib/projectProgress";
import {
  beatsCheckPrompt,
  continuityPrompt,
  REVISE_SHORTCUTS,
  revisePrompt,
  SYSTEM_WRITER,
} from "../lib/prompts";
import { runChapterScan, type ScanHit } from "../lib/scan";
import { addUsage } from "../lib/usageLedger";
import { loadChapterBeatsText } from "../lib/volumes";
import type { WritePipelinePhase, WritePipelineResult } from "../lib/writePipeline";
import type { AppSettings, KbChunk } from "../types";
import type { ProviderConfig } from "../lib/providerPresets";
import { ChapterDiffDrawer } from "./ChapterDiffDrawer";

type Props = {
  root: string;
  join: (...p: string[]) => Promise<string>;
  settings: AppSettings;
  providers: ProviderConfig[];
  chapterId: string;
  chapterTitle: string;
  setChapterTitle: (t: string) => void;
  targetWords: number;
  setTargetWords: (words: number) => void;
  doc: string;
  setDoc: (v: string | ((prev: string) => string)) => void;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  llmReady: boolean;
  hasBeats: boolean;
  onNeedSetup: () => void;
  onHint: (s: string) => void;
  onErr: (s: string) => void;
  nextChapter: () => void;
  prevChapter?: () => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  /** 与 Studio 共用，便于顶栏「停止」 */
  abortRef: React.MutableRefObject<AbortController | null>;
  /** 外部热键「生成」会调用 */
  writeChapterRef?: React.MutableRefObject<(() => Promise<void>) | null>;
};

export function formatChapterWriteReport(
  words: number,
  targetWords: number,
  beatsReport = ""
): string {
  const safeTarget = Math.max(1, Math.round(targetWords));
  const ratio = Math.round((words / safeTarget) * 100);
  const checkHint = beatsReport.trim() ? "；自检见工具区" : "";
  return `已写入 约 ${words} 字（目标 ${safeTarget}，达标率 ${ratio}%${checkHint}）`;
}

export function ChapterTools(props: Props) {
  const {
    root,
    join,
    settings,
    providers,
    chapterId,
    chapterTitle,
    setChapterTitle,
    targetWords,
    setTargetWords,
    doc,
    setDoc,
    editorRef,
    llmReady,
    hasBeats,
    onNeedSetup,
    onHint,
    onErr,
    nextChapter,
    busy,
    setBusy,
    abortRef,
    writeChapterRef,
  } = props;

  const prevChapter = props.prevChapter;

  const [stream, setStream] = useState("");
  const [pipelineProgress, setPipelineProgress] = useState("");
  const [toolsMore, setToolsMore] = useState(false);
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [presetOverride, setPresetOverride] = useState<"" | WritePreset>("");
  const [skipBeatsLocal, setSkipBeatsLocal] = useState(false);
  const [skipPolishLocal, setSkipPolishLocal] = useState(false);
  const [hasPipelineSnapshot, setHasPipelineSnapshot] = useState(false);
  const skipPolishNowRef = useRef(false);
  const lastPipelineRef = useRef<{
    body: string;
    beatsReport: string;
    ok: boolean;
  } | null>(null);

  const license = checkLicense(settings);

  const [polishOpen, setPolishOpen] = useState(false);
  const [instruction, setInstruction] = useState("加强冲突，对白更有声口。");
  const [selection, setSelection] = useState("");
  const [selRange, setSelRange] = useState<{ start: number; end: number } | null>(null);
  const [drafts, setDrafts] = useState<{ A: string; B: string; C: string }>({
    A: "",
    B: "",
    C: "",
  });
  const [pick, setPick] = useState<"A" | "B" | "C">("A");
  const [continuityReport, setContinuityReport] = useState("");
  const [beatsReport, setBeatsReport] = useState("");
  const [scanHits, setScanHits] = useState<ScanHit[]>([]);
  const [hooks, setHooks] = useState<HookItem[]>([]);
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [costHint, setCostHint] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLeft, setDiffLeft] = useState("");
  const [diffLeftLabel, setDiffLeftLabel] = useState("备份");
  const [diffMeta, setDiffMeta] = useState<BackupMeta | null>(null);
  const [preWriteBackupId, setPreWriteBackupId] = useState<string | null>(null);
  const lastSavedWords = useRef(0);
  const phaseLogRef = useRef<string[]>([]);
  const [draftSlot, setDraftSlot] = useState<DraftSlot>("A");
  const draftAHoldRef = useRef("");
  const [beatAlignRows, setBeatAlignRows] = useState<BeatAlignRow[]>([]);

  useEffect(() => {
    lastSavedWords.current = countTextWords(doc);
  }, [chapterId]);

  async function refreshMeta() {
    const ledger = await loadHooksLedger(root, join);
    setHooks(ledger.items.filter((h) => h.status === "open").slice(-8));
    setBackups(await listBackups(root, join, chapterId));
    const prices = await loadPrices(join);
    const enabled = providers.find((p) => p.enabled && p.apiKey.trim());
    const price = pickPrice(prices, enabled?.id);
    setCostHint(`${price.label} 写一章粗估 ${formatCny(estimateCostCny(4000, targetWords, price.cnyPer1k))}`);
  }

  useEffect(() => {
    void refreshMeta();
    setContinuityReport("");
    setBeatsReport("");
    setDrafts({ A: "", B: "", C: "" });
    setScanHits([]);
    setStream("");
    setPipelineProgress("");
    setScanHits([]);
    setHasPipelineSnapshot(false);
    lastPipelineRef.current = null;
    phaseLogRef.current = [];
    setDraftSlot("A");
    draftAHoldRef.current = "";
    setBeatAlignRows([]);
    void (async () => {
      try {
        const t = await window.moshu!.readText(
          await join(root, "ideas", `chapter-notes-${chapterId}.md`)
        );
        setNotes(t);
      } catch {
        setNotes("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, chapterId, join]);

  async function saveNotes(next: string) {
    setNotes(next);
    if (!window.moshu) return;
    await window.moshu.writeText(
      await join(root, "ideas", `chapter-notes-${chapterId}.md`),
      next
    );
  }

  function cancel() {
    abortRef.current?.abort();
  }

  async function loadContext() {
    const bible = await window.moshu!.readText(await join(root, "bible", "world.md"));
    const style = await window.moshu!.readText(await join(root, "prompts", "style.md"));
    const beatsLoaded = await loadChapterBeatsText({ root, join, chapterId });
    const beats = beatsLoaded.text;
    const characters = await loadCharactersMarkdown(root, join);
    const chapters = await window.moshu!.listDir(await join(root, "chapters"));
    let prevTail = "";
    const prevFile = pickPrevChapterFile(chapters, chapterId);
    if (prevFile) prevTail = await window.moshu!.readText(prevFile.path);
    const kbIndex = await window.moshu!.readJson<{ chunks: KbChunk[] }>(
      await join(root, "kb", "index.json"),
      { chunks: [] }
    );
    const kbHits = retrieveChunks(kbIndex.chunks || [], `${chapterTitle} ${beats.slice(0, 200)}`, 5);
    const ledger = await loadHooksLedger(root, join);
    return {
      bible,
      style,
      beats,
      characters,
      prevTail,
      kb: formatKbForPrompt(kbHits),
      openHooks: formatOpenHooksForPrompt(ledger, 12, chapterId),
    };
  }

  async function writeChapter(resume?: {
    from: WritePipelinePhase;
    body: string;
  }) {
    if (!window.moshu) return;
    if (!license.ok) {
      onErr(license.reason || "试用已到期，请到设置填写授权码");
      return;
    }
    if (!llmReady) {
      onNeedSetup();
      return;
    }
    if (!hasBeats) {
      onErr("细纲里还没有本章场次，请先在「细纲」写好对应章节");
      return;
    }
    if (!resume && doc.trim() && !confirmOverwrite(`${chapterId} 正文`)) return;

    if (!resume && settings.confirmCostBeforeWrite !== false) {
      const hint = costHint || "将调用模型写一章，可能产生费用";
      if (!window.confirm(`${hint}\n\n确认开始写本章？`)) return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    onErr("");
    setStream("");
    setPipelineProgress("");
    phaseLogRef.current = [];
    skipPolishNowRef.current = false;
    let pipelineBeatsReport = "";
    try {
      if (!resume && doc.trim()) {
        const meta = await backupChapter({
          root,
          join,
          chapterId,
          body: doc,
          note: "重写前备份",
        });
        if (meta) setPreWriteBackupId(meta.id);
      }
      const text = await writeOneChapter({
        root,
        join,
        chapterId,
        chapterTitle,
        settings,
        providers,
        targetWords,
        signal: ac.signal,
        writePreset: presetOverride || undefined,
        skipBeatsCheck: skipBeatsLocal || undefined,
        skipPolish: skipPolishLocal || undefined,
        getSkipPolish: () => skipPolishNowRef.current,
        resumeFrom: resume?.from,
        resumeBody: resume?.body,
        onDelta: (d) => {
          setStream((s) => {
            const next = s + d;
            setDoc(next);
            return next;
          });
        },
        onProgress: (progress) => {
          setPipelineProgress(progress.label);
          phaseLogRef.current.push(progress.label);
          if (progress.bodySoFar != null) {
            setDoc(progress.bodySoFar);
            setStream(progress.bodySoFar);
            lastPipelineRef.current = {
              body: progress.bodySoFar,
              beatsReport: lastPipelineRef.current?.beatsReport || "",
              ok: false,
            };
            setHasPipelineSnapshot(true);
          }
          onHint(progress.label);
        },
        onResult: (result: WritePipelineResult) => {
          pipelineBeatsReport = result.beatsReport;
          setBeatsReport(result.beatsReport);
          lastPipelineRef.current = {
            body: result.body,
            beatsReport: result.beatsReport,
            ok: true,
          };
          setHasPipelineSnapshot(true);
        },
      });
      setDoc(text);
      setStream("");
      const w = countTextWords(text);
      const prevWords = lastSavedWords.current;
      lastSavedWords.current = w;
      const prices = await loadPrices(join);
      const enabled = providers.find((p) => p.enabled && p.apiKey.trim());
      const price = pickPrice(prices, enabled?.id);
      const cost = estimateCostCny(4000, w, price.cnyPer1k);
      await addUsage({ words: Math.max(0, w - prevWords), costCny: cost });
      onHint(formatChapterWriteReport(w, targetWords, pipelineBeatsReport));
      await refreshMeta();
    } catch (e) {
      if (isAbortError(e)) onHint("已取消");
      else {
        const msg = humanizeLlmError(e);
        const lastPhase = [...phaseLogRef.current].reverse().find(Boolean) || pipelineProgress;
        const withPhase =
          lastPhase && !msg.includes(lastPhase) ? `${msg}\n（阶段：${lastPhase}）` : msg;
        if (shouldEnqueue(e)) {
          await enqueueJob(root, join, {
            kind: "chapter",
            chapterId,
            chapterTitle,
            error: withPhase,
          });
          onErr(withPhase + "\n已加入待重试队列，可在进度页重试。");
        } else onErr(withPhase);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      setStream("");
      setPipelineProgress("");
    }
  }

  async function saveAsDraftB() {
    if (!doc.trim()) {
      onErr("当前正文为空，无法存为 B 稿");
      return;
    }
    await saveDraftB(root, join, chapterId, doc);
    onHint("已存为 B 稿");
  }

  async function loadDraftBIntoEditor() {
    const b = await loadDraftB(root, join, chapterId);
    if (!b.trim()) {
      onErr("还没有 B 稿");
      return;
    }
    if (doc.trim() && !confirmOverwrite("用 B 稿覆盖编辑器内容（未升主前可再存 A）")) return;
    draftAHoldRef.current = doc;
    setDoc(b);
    setDraftSlot("B");
    onHint("已加载 B 稿到编辑器");
  }

  async function toggleDraftPreview() {
    if (draftSlot === "A") {
      const b = await loadDraftB(root, join, chapterId);
      if (!b.trim()) {
        onErr("还没有 B 稿，请先「存为B稿」");
        return;
      }
      draftAHoldRef.current = doc;
      setDoc(b);
      setDraftSlot("B");
      onHint("预览 B 稿（A 稿仍在内存）");
    } else {
      setDoc(draftAHoldRef.current);
      setDraftSlot("A");
      onHint("已切回 A 稿预览");
    }
  }

  async function promoteDraftB() {
    const b = await loadDraftB(root, join, chapterId);
    if (!b.trim()) {
      onErr("还没有 B 稿");
      return;
    }
    if (!window.confirm("将 B 稿升为主稿并覆盖 chapters 当前正文？此操作不可自动撤销。")) {
      return;
    }
    if (doc.trim()) {
      await backupChapter({ root, join, chapterId, body: doc, note: "升B为主前备份" });
    }
    setDoc(b);
    draftAHoldRef.current = b;
    setDraftSlot("A");
    await syncChapterFileName({
      root,
      join,
      chapterId,
      title: chapterTitle,
      body: b,
    });
    onHint("B 稿已升为主稿（已写入 chapters）");
  }

  async function refreshBeatAlign() {
    const beatsLoaded = await loadChapterBeatsText({ root, join, chapterId });
    setBeatAlignRows(alignBeatsToBody(beatsLoaded.text, doc));
  }

  function resumeFromPhase(from: "beats_check" | "polish") {
    const body = lastPipelineRef.current?.body || doc;
    if (!body.trim()) {
      onErr("没有可续跑的正文");
      return;
    }
    void writeChapter({ from, body });
  }

  useEffect(() => {
    if (writeChapterRef) writeChapterRef.current = () => writeChapter();
    return () => {
      if (writeChapterRef) writeChapterRef.current = null;
    };
  });

  function captureSelection() {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) {
      onErr("请先划选要改的句子或段落");
      return;
    }
    setSelRange({ start, end });
    setSelection(doc.slice(start, end));
    onErr("");
  }

  async function reviseTriple() {
    if (!selection || !selRange) {
      captureSelection();
      return;
    }
    if (!llmReady) {
      onNeedSetup();
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    onErr("");
    setDrafts({ A: "", B: "", C: "" });
    try {
      const ctx = await loadContext();
      const base = {
        selection,
        instruction,
        before: doc.slice(Math.max(0, selRange.start - 800), selRange.start),
        after: doc.slice(selRange.end, selRange.end + 800),
        bible: ctx.bible,
        kb: ctx.kb,
      };
      const run = async (variant: "A" | "B" | "C") => {
        const text = await chatCompletion(
          settings,
          [
            { role: "system", content: SYSTEM_WRITER },
            { role: "user", content: revisePrompt({ ...base, variant }) },
          ],
          {
            providers,
            signal: ac.signal,
            onDelta: (d) =>
              setDrafts((prev) => ({ ...prev, [variant]: (prev[variant] || "") + d })),
          }
        );
        setDrafts((prev) => ({ ...prev, [variant]: text }));
      };
      await run("A");
      await run("B");
      await run("C");
      setPick("A");
    } catch (e) {
      if (isAbortError(e)) onHint("已取消改稿");
      else onErr(humanizeLlmError(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function acceptRevise() {
    if (!selRange || !window.moshu) return;
    const draft = drafts[pick];
    if (!draft) return;
    await backupChapter({ root, join, chapterId, body: doc, note: "润色前" });
    const next = doc.slice(0, selRange.start) + draft + doc.slice(selRange.end);
    setDoc(next);
    setPolishOpen(false);
    setSelection("");
    setSelRange(null);
    onHint("已采用润色稿");
  }

  async function runContinuityCheck() {
    if (!llmReady) {
      onNeedSetup();
      return;
    }
    setBusy(true);
    onErr("");
    try {
      const ctx = await loadContext();
      const text = await chatCompletion(
        settings,
        [
          { role: "system", content: SYSTEM_WRITER },
          {
            role: "user",
            content: continuityPrompt({
              prevTail: ctx.prevTail,
              bible: ctx.bible,
              characters: ctx.characters,
              chapter: doc,
            }),
          },
        ],
        { providers, model: settings.routeCheck || settings.routeChapter || "复杂" }
      );
      setContinuityReport(text);
    } catch (e) {
      onErr(humanizeLlmError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBeatsCheck() {
    if (!llmReady) {
      onNeedSetup();
      return;
    }
    setBusy(true);
    onErr("");
    try {
      const ctx = await loadContext();
      if (!ctx.beats.trim()) {
        onErr("细纲里还没有本章场次");
        return;
      }
      const text = await chatCompletion(
        settings,
        [
          { role: "system", content: SYSTEM_WRITER },
          {
            role: "user",
            content: beatsCheckPrompt(ctx.beats, doc),
          },
        ],
        { providers, model: settings.routeCheck || settings.routeChapter || "复杂" }
      );
      setBeatsReport(text);
    } catch (e) {
      onErr(humanizeLlmError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runLocalScan() {
    const beatsLoaded = await loadChapterBeatsText({
      root,
      join,
      chapterId,
    });
    const charsMd = await loadCharactersMarkdown(root, join);
    const characterNames = (charsMd.match(/^#\s+(.+)$/gm) || []).map((l) =>
      l.replace(/^#\s+/, "").trim()
    );
    const hits = await runChapterScan({
      root,
      join,
      body: doc,
      beats: beatsLoaded.text,
      characterNames,
    });
    setScanHits(hits);
    onHint(hits.length ? `扫描到 ${hits.length} 处` : "扫描通过");
  }

  async function reExtractHooks() {
    if (!llmReady) {
      onNeedSetup();
      return;
    }
    setBusy(true);
    try {
      await extractAndSaveHooks({
        root,
        join,
        chapterId,
        body: doc,
        settings,
        providers,
      });
      onHint("钩子已更新");
      await refreshMeta();
    } catch (e) {
      onErr(humanizeLlmError(e));
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(meta: BackupMeta) {
    if (!confirmOverwrite("用备份覆盖当前正文")) return;
    const text = await restoreBackup(root, join, meta);
    setDoc(text);
    onHint("已从备份恢复");
  }

  async function openDiff(meta: BackupMeta) {
    const text = await restoreBackup(root, join, meta);
    setDiffLeft(text);
    setDiffLeftLabel(meta.note || meta.createdAt);
    setDiffMeta(meta);
    setDiffOpen(true);
  }

  async function openPreWriteDiff() {
    const meta = backups.find((b) => b.id === preWriteBackupId) || backups[0];
    if (!meta) {
      onErr("暂无写前备份可对比");
      return;
    }
    await openDiff(meta);
  }

  function speak() {
    if (!doc.trim() || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(doc.slice(0, 8000));
    u.lang = "zh-CN";
    window.speechSynthesis.speak(u);
  }

  function stopSpeak() {
    window.speechSynthesis?.cancel();
  }

  async function toggleHook(h: HookItem) {
    if (h.status === "open") await resolveHook(root, join, h.id);
    else await reopenHook(root, join, h.id);
    await refreshMeta();
  }

  const words = countTextWords(doc);
  const showingPipelineProgress = busy && Boolean(pipelineProgress || stream) && !drafts.A;
  const effectivePreset =
    presetOverride || (settings.writePreset === "fast" ? "fast" : "quality");
  const canResumePipeline =
    !busy && hasPipelineSnapshot && Boolean(lastPipelineRef.current?.body || doc.trim());

  return (
    <div className="chapter-tools">
      <div className="chapter-tools-bar">
        <button
          type="button"
          className="btn btn-primary btn-compact"
          disabled={busy || !license.ok || !hasBeats}
          title={
            !license.ok
              ? license.reason
              : !hasBeats
                ? "请先补本章细纲"
                : undefined
          }
          onClick={() => void writeChapter()}
        >
          {busy && pipelineProgress ? "写作中…" : doc.trim() ? "重写本章" : "写本章"}
        </button>
        {busy && (
          <button type="button" className="btn btn-danger btn-compact" onClick={cancel}>
            取消
          </button>
        )}
        <label className="studio-chapters-n" title="本次写作预设（不写回设置）">
          <span>预设</span>
          <select
            value={presetOverride}
            disabled={busy}
            onChange={(e) => setPresetOverride(e.target.value as "" | WritePreset)}
          >
            <option value="">默认（{settings.writePreset === "fast" ? "快速" : "质量"}）</option>
            <option value="quality">质量</option>
            <option value="fast">快速</option>
          </select>
        </label>
        {prevChapter && (
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => {
              prevChapter();
              onHint("已切到上一章");
            }}
          >
            上一章
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          onClick={() => {
            nextChapter();
            onHint("已切到下一章");
          }}
        >
          下一章
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          onClick={() => setNotesOpen((v) => !v)}
        >
          {notesOpen ? "收起备注" : "本章备注"}
        </button>
        <button
          type="button"
          className={`btn btn-ghost btn-compact ${toolsMore ? "active" : ""}`}
          onClick={() => setToolsMore((v) => !v)}
        >
          {toolsMore ? "收起工具" : "更多工具"}
        </button>
        <label className="studio-chapters-n" title="目标字数">
          <span>目标</span>
          <input
            type="number"
            min={800}
            max={8000}
            value={targetWords}
            onChange={(e) => setTargetWords(Math.max(800, Number(e.target.value) || 2500))}
          />
        </label>
        <input
          className="chapter-tools-title"
          value={chapterTitle}
          onChange={(e) => setChapterTitle(e.target.value)}
          placeholder="章标题"
          aria-label="章标题"
        />
        <span className="muted" style={{ fontSize: 12 }}>
          {words} 字{costHint ? ` · ${costHint}` : ""}
          {effectivePreset === "fast" ? " · 快速" : ""}
        </span>
      </div>
      {notesOpen && (
        <div className="field" style={{ margin: 0 }}>
          <label>本章作者备注（写章时会注入提示）</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => void saveNotes(e.target.value)}
            placeholder="例：本章必须回收上章钩子；对白偏冷…"
            style={{ minHeight: 72, width: "100%" }}
          />
        </div>
      )}
      {toolsMore && (
        <div className="chapter-tools-bar">
          <label className="check-row" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={skipBeatsLocal}
              disabled={busy || effectivePreset === "fast"}
              onChange={(e) => setSkipBeatsLocal(e.target.checked)}
            />
            跳过自检
          </label>
          <label className="check-row" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={skipPolishLocal}
              disabled={busy || effectivePreset === "fast"}
              onChange={(e) => setSkipPolishLocal(e.target.checked)}
            />
            跳过润色
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => setPolishOpen((v) => !v)}
          >
            {polishOpen ? "收起润色" : "润色"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy || !doc.trim()}
            onClick={() => void runLocalScan()}
          >
            扫描
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy || !doc.trim()}
            onClick={() => void runBeatsCheck()}
          >
            细纲对照
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy || !doc.trim()}
            onClick={() => void runContinuityCheck()}
          >
            连贯
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy || !doc.trim()}
            onClick={() => void reExtractHooks()}
          >
            抽钩子
          </button>
          <button type="button" className="btn btn-ghost btn-compact" disabled={!doc.trim()} onClick={speak}>
            朗读
          </button>
          <button type="button" className="btn btn-ghost btn-compact" onClick={stopSpeak}>
            停读
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy || !doc.trim()}
            onClick={() => void saveAsDraftB()}
          >
            存为B稿
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy}
            onClick={() => void loadDraftBIntoEditor()}
          >
            加载B
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy}
            onClick={() => void toggleDraftPreview()}
            title={draftSlot === "A" ? "当前预览 A" : "当前预览 B"}
          >
            A↔B切换预览
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy}
            onClick={() => void promoteDraftB()}
          >
            升B为主
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy}
            onClick={() => void refreshBeatAlign()}
          >
            场次对齐
          </button>
        </div>
      )}
      {beatAlignRows.length > 0 && (
        <div className="scan-box">
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            细纲场次覆盖（绿=命中 / 红=缺失）· 预览槽 {draftSlot}
          </div>
          {beatAlignRows.map((row, i) => (
            <div key={`${row.title}-${i}`} className="scan-hit">
              <strong style={{ color: row.covered ? "var(--ok, #2a7)" : "var(--danger)" }}>
                {row.covered ? "已覆盖" : "缺失"}
              </strong>{" "}
              · {row.title}
              <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                关键词命中 {row.hitCount}/{row.keywords.length}
              </span>
            </div>
          ))}
        </div>
      )}
      {showingPipelineProgress && (
        <div className="studio-pipeline-progress">
          <span>{pipelineProgress || "正在写入编辑器…"}</span>
          {stream && <span>约 {countTextWords(stream)} 字</span>}
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => {
              skipPolishNowRef.current = true;
              setSkipPolishLocal(true);
              onHint("将跳过润色阶段");
            }}
          >
            跳过润色
          </button>
        </div>
      )}
      {canResumePipeline && (
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy || !hasBeats}
            onClick={() => resumeFromPhase("beats_check")}
          >
            从自检重试
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            disabled={busy || !hasBeats}
            onClick={() => resumeFromPhase("polish")}
          >
            从润色重试
          </button>
        </div>
      )}

      {hooks.length > 0 && (
        <div className="chapter-tools-hooks">
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              未解钩子
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => void resolveHooksBeforeChapter(root, join, chapterId).then(refreshMeta)}
            >
              更早钩子已推进
            </button>
          </div>
          <ul className="hook-list">
            {hooks.map((h) => (
              <li key={h.id}>
                <label className="check-row">
                  <input type="checkbox" checked={false} onChange={() => void toggleHook(h)} />
                  [{h.kind}/{h.fromChapter}] {h.text}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {polishOpen && (
        <div className="chapter-tools-polish panel stack" style={{ padding: 12 }}>
          <div className="row">
            <button type="button" className="btn btn-compact" onClick={captureSelection}>
              读取选区
            </button>
            {REVISE_SHORTCUTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => setInstruction(s.instruction)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="改稿指令"
          />
          <button
            type="button"
            className="btn btn-primary btn-compact"
            disabled={busy}
            onClick={() => void reviseTriple()}
          >
            生成三候选
          </button>
          {(drafts.A || drafts.B || drafts.C) && (
            <>
              <div className="row">
                {(["A", "B", "C"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`btn btn-compact ${pick === k ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setPick(k)}
                  >
                    候选 {k}
                  </button>
                ))}
                <button type="button" className="btn btn-primary btn-compact" onClick={() => void acceptRevise()}>
                  采用 {pick}
                </button>
              </div>
              <pre className="stream-box" style={{ maxHeight: 160, whiteSpace: "pre-wrap" }}>
                {drafts[pick]}
              </pre>
            </>
          )}
        </div>
      )}

      {scanHits.length > 0 && (
        <div className="scan-box">
          {scanHits.map((h, i) => (
            <div key={i} className="scan-hit">
              <strong>{h.kind}</strong> · {h.text} — {h.detail}
            </div>
          ))}
        </div>
      )}
      {beatsReport && (
        <div className="stream-box" style={{ maxHeight: 180 }}>
          {beatsReport}
        </div>
      )}
      {continuityReport && (
        <div className="stream-box" style={{ maxHeight: 180 }}>
          {continuityReport}
        </div>
      )}
      {backups.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            备份
          </span>
          {preWriteBackupId && (
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => void openPreWriteDiff()}
            >
              与写前对比
            </button>
          )}
          {backups.slice(0, 4).map((b) => (
            <span key={b.id} className="row" style={{ gap: 4 }}>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => void openDiff(b)}
                title="对比"
              >
                对比 {b.createdAt.slice(5, 16).replace("T", " ")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => void doRestore(b)}
                title="整章还原"
              >
                还原
              </button>
            </span>
          ))}
        </div>
      )}
      <ChapterDiffDrawer
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        root={root}
        join={join}
        leftLabel={diffLeftLabel}
        leftText={diffLeft}
        rightText={doc}
        backupMeta={diffMeta}
        onApply={(next) => {
          setDoc(next);
          onHint("已应用 Diff 结果（记得 Ctrl+S 保存）");
        }}
      />
    </div>
  );
}
