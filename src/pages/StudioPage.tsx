import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { applyEditorAppearance, resolveEditorColors } from "../lib/editorAppearance";
import { exportBook } from "../lib/exportBook";
import {
  ensureVolumeBeatsFile,
  findVolumeForChapter,
  type VolumeEntry,
} from "../lib/volumes";
import type { AppSettings } from "../types";
import { useApp } from "../state/AppContext";
import { StudioAgentPanel } from "./studio/StudioAgentPanel";
import { StudioEditorPane } from "./studio/StudioEditorPane";
import { EMPTY_VOLUMES, modeFromPath, type StudioMode } from "./studio/studioShared";
import { useStudioDocument } from "./studio/useStudioDocument";
import { useStudioGenerate } from "./studio/useStudioGenerate";

export type { StudioMode };

export function StudioPage() {
  const loc = useLocation();
  const nav = useNavigate();
  const mode = modeFromPath(loc.pathname);
  const {
    project,
    settings,
    patchSettings,
    join,
    providers,
    llmReady,
    chapterId,
    setChapterId,
    chapterTitle,
    setChapterTitle,
    volumeId,
    setVolumeId,
    nextChapter: ctxNextChapter,
    prevChapter: ctxPrevChapter,
  } = useApp();

  const [chaptersPerVolume, setChaptersPerVolume] = useState(30);
  const [chapterTargetWords, setChapterTargetWords] = useState(
    settings.defaultChapterWords ?? 2500
  );
  const [beatsDrawerOpen, setBeatsDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview" | "split">("edit");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const docApi = useStudioDocument({
    mode,
    project,
    join,
    settings,
    chapterId,
    setChapterId,
    chapterTitle,
    setChapterTitle,
    volumeId,
    setVolumeId,
  });

  const {
    doc,
    setDoc,
    seed,
    outline,
    setOutline,
    bible,
    style,
    volumes,
    setVolumes,
    chapterBeats,
    hint,
    setHint,
    err,
    setErr,
    loadingDoc,
    messages,
    setMessages,
    fileHint,
    scopeKey,
    refreshVolumes,
    saveNow,
  } = docApi;

  const currentVolume: VolumeEntry | null =
    volumes.find((v) => v.id === volumeId) || volumes[0] || null;

  const gen = useStudioGenerate({
    mode,
    project,
    join,
    settings,
    providers,
    llmReady,
    chapterId,
    chapterTitle,
    volumeId,
    currentVolume,
    chaptersPerVolume,
    chapterTargetWords,
    setChapterTargetWords,
    editorRef,
    docApi: {
      doc,
      setDoc,
      seed,
      bible,
      outline,
      setOutline,
      style,
      chapterBeats,
      messages,
      setMessages,
      setHint,
      setErr,
      refreshVolumes,
      scopeKey,
    },
  });

  gen.saveNowRef.current = saveNow;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, gen.agentBusy]);

  // 书内搜索跳转
  useEffect(() => {
    if (mode !== "chapter" || loadingDoc) return;
    try {
      const raw = sessionStorage.getItem("moshu.searchJump");
      if (!raw) return;
      const jump = JSON.parse(raw) as {
        chapterId?: string;
        query?: string;
        line?: number;
      };
      sessionStorage.removeItem("moshu.searchJump");
      if (jump.chapterId && jump.chapterId !== chapterId) return;
      if (jump.query) {
        setFindQuery(jump.query);
        setFindOpen(true);
      }
      window.setTimeout(() => {
        const el = editorRef.current;
        if (!el || !doc) return;
        if (jump.query) {
          const idx = doc.indexOf(jump.query);
          if (idx >= 0) {
            el.focus();
            el.setSelectionRange(idx, idx + jump.query.length);
            const lineH = (settings.editorFontSize || 16) * (settings.editorLineHeight || 1.75);
            const before = doc.slice(0, idx);
            const lineNo = before.split("\n").length;
            el.scrollTop = Math.max(0, (lineNo - 3) * lineH);
            return;
          }
        }
        if (jump.line && jump.line > 0) {
          const lines = doc.split("\n");
          let pos = 0;
          for (let i = 0; i < Math.min(jump.line - 1, lines.length); i++) {
            pos += lines[i].length + 1;
          }
          el.focus();
          el.setSelectionRange(pos, pos);
          const lineH = (settings.editorFontSize || 16) * (settings.editorLineHeight || 1.75);
          el.scrollTop = Math.max(0, (jump.line - 3) * lineH);
        }
      }, 80);
    } catch {
      /* ignore */
    }
  }, [mode, loadingDoc, chapterId, doc, settings.editorFontSize, settings.editorLineHeight]);

  // findInDoc hotkey (save/generate handled in useStudioGenerate)
  useEffect(() => {
    const onHotkey = (ev: Event) => {
      const action = (ev as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "findInDoc") {
        setFindOpen(true);
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>(".studio-find-bar input")?.focus();
        }, 30);
      }
    };
    window.addEventListener("moshu:hotkey", onHotkey);
    return () => window.removeEventListener("moshu:hotkey", onHotkey);
  }, []);

  function replaceInDoc(all: boolean) {
    if (!findQuery) return;
    if (all) {
      setDoc((prev) => prev.split(findQuery).join(replaceQuery));
      setHint(`已全部替换「${findQuery}」`);
      return;
    }
    const el = editorRef.current;
    const start = el?.selectionStart ?? 0;
    const idx = doc.indexOf(findQuery, start);
    const at = idx >= 0 ? idx : doc.indexOf(findQuery);
    if (at < 0) {
      setHint("未找到");
      return;
    }
    const next = doc.slice(0, at) + replaceQuery + doc.slice(at + findQuery.length);
    setDoc(next);
    window.setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(at, at + replaceQuery.length);
    }, 0);
  }

  function findNext() {
    if (!findQuery) return;
    const el = editorRef.current;
    const start = (el?.selectionEnd ?? 0) || 0;
    let idx = doc.indexOf(findQuery, start);
    if (idx < 0) idx = doc.indexOf(findQuery);
    if (idx < 0) {
      setHint("未找到");
      return;
    }
    el?.focus();
    el?.setSelectionRange(idx, idx + findQuery.length);
  }

  function selectChapter(id: string, title: string) {
    setChapterId(id);
    setChapterTitle(title);
    const vol = findVolumeForChapter(volumes, id);
    if (vol) setVolumeId(vol.id);
  }

  async function createNextVolume() {
    if (!project || !window.moshu) return;
    const max = Math.max(
      0,
      ...volumes.map((v) => Number(v.id.match(/\d+/)?.[0] || 0)),
      Number(volumeId.match(/\d+/)?.[0] || 0)
    );
    const nextId = `第${max + 1}卷`;
    await ensureVolumeBeatsFile({ root: project.root, join, volumeId: nextId });
    const vols = await refreshVolumes();
    if (!vols.some((v) => v.id === nextId)) {
      setVolumes([
        ...(vols.length ? vols : EMPTY_VOLUMES),
        { id: nextId, title: nextId, chapters: [] },
      ]);
    }
    setVolumeId(nextId);
    setHint(`已新建 ${nextId}，可在此卷聊细纲`);
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const allChapters = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; title: string; blurb: string }[] = [];
    for (const v of volumes) {
      for (const c of v.chapters) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        list.push(c);
      }
    }
    return list;
  }, [volumes]);

  const fontSize = settings.editorFontSize || 16;
  const lineHeight = settings.editorLineHeight || 1.75;
  const { bg: editorBg, fg: editorFg, theme: editorTheme } = resolveEditorColors(settings);

  const patchAppear = useCallback(
    async (partial: Partial<AppSettings>) => {
      const next = { ...settings, ...partial };
      applyEditorAppearance(next);
      await patchSettings(partial);
    },
    [settings, patchSettings]
  );

  async function quickExportTxt() {
    if (!project) return;
    try {
      await exportBook({
        root: project.root,
        join,
        title: project.project.title,
        format: "qidian",
      });
      setHint("已导出 TXT");
    } catch {
      setErr("导出失败");
    }
  }

  async function quickZipBackup() {
    if (!project || !window.moshu?.zipProjectBackup) return;
    try {
      const r = await window.moshu.zipProjectBackup({
        root: project.root,
        title: project.project.title,
      });
      setHint(r.ok ? "已备份到下载目录" : r.message);
      if (r.ok && r.filePath) void window.moshu.showItemInFolder?.(r.filePath);
    } catch {
      setErr("备份失败");
    }
  }

  if (!project) {
    return (
      <div className="panel">
        <Link to="/">回首页打开书稿</Link>
      </div>
    );
  }

  return (
    <div className="studio">
      <StudioEditorPane
        mode={mode}
        fileHint={fileHint}
        hint={hint}
        err={err}
        fontSize={fontSize}
        lineHeight={lineHeight}
        editorBg={editorBg}
        editorFg={editorFg}
        editorTheme={editorTheme}
        patchAppear={(partial) => void patchAppear(partial)}
        volumeId={volumeId}
        setVolumeId={setVolumeId}
        volumes={volumes}
        chaptersPerVolume={chaptersPerVolume}
        setChaptersPerVolume={setChaptersPerVolume}
        createNextVolume={() => void createNextVolume()}
        chapterId={chapterId}
        chapterTitle={chapterTitle}
        allChapters={allChapters}
        selectChapter={selectChapter}
        busy={gen.busy}
        agentBusy={gen.agentBusy}
        cancel={gen.cancel}
        quickExportTxt={() => void quickExportTxt()}
        quickZipBackup={() => void quickZipBackup()}
        chapterBeats={chapterBeats}
        beatsDrawerOpen={beatsDrawerOpen}
        setBeatsDrawerOpen={setBeatsDrawerOpen}
        goPrevChapter={() => ctxPrevChapter()}
        goNextChapter={() => ctxNextChapter()}
        viewMode={viewMode}
        setViewMode={setViewMode}
        findOpen={findOpen}
        setFindOpen={setFindOpen}
        findQuery={findQuery}
        setFindQuery={setFindQuery}
        replaceQuery={replaceQuery}
        setReplaceQuery={setReplaceQuery}
        findNext={findNext}
        replaceInDoc={replaceInDoc}
        liveSel={gen.liveSel}
        editScope={gen.editScope}
        lockSelectionFromEditor={gen.lockSelectionFromEditor}
        lockWholeDocument={gen.lockWholeDocument}
        clearEditScope={gen.clearEditScope}
        sendChat={(t) => void gen.sendChat(t)}
        loadingDoc={loadingDoc}
        doc={doc}
        setDoc={setDoc}
        editorRef={editorRef}
        syncLiveSelection={gen.syncLiveSelection}
        showNextStep={gen.showNextStep}
        setShowNextStep={gen.setShowNextStep}
        projectRoot={project.root}
        join={join}
        settings={settings}
        providers={providers}
        setChapterTitle={setChapterTitle}
        chapterTargetWords={chapterTargetWords}
        setChapterTargetWords={setChapterTargetWords}
        llmReady={llmReady}
        onNeedSetup={() => nav("/setup")}
        setHint={setHint}
        setErr={setErr}
        setBusy={gen.setBusy}
        abortRef={gen.abortRef}
        writeChapterRef={gen.writeChapterRef}
      />
      <StudioAgentPanel
        mode={mode}
        editScope={gen.editScope}
        messages={messages}
        input={gen.input}
        setInput={gen.setInput}
        agentBusy={gen.agentBusy}
        busy={gen.busy}
        generateDisabled={gen.generateDisabled}
        licenseOk={gen.license.ok}
        licenseReason={gen.license.reason}
        chaptersPerVolume={chaptersPerVolume}
        volumeId={volumeId}
        chapterId={chapterId}
        chapterTitle={chapterTitle}
        chapterBeats={chapterBeats}
        currentVolume={currentVolume}
        doc={doc}
        lastAssistant={lastAssistant}
        chatEndRef={chatEndRef}
        clearChat={gen.clearChat}
        sendChat={(t) => void gen.sendChat(t)}
        generateFromChat={(r, b) => void gen.generateFromChat(r, b)}
        applyToEditor={gen.applyToEditor}
      />
    </div>
  );
}
