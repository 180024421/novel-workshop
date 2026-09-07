import type { RefObject, MutableRefObject } from "react";
import { Link } from "react-router-dom";
import { ChapterTools } from "../../components/ChapterTools";
import { EmptyGuide } from "../../components/EmptyGuide";
import { marked } from "marked";
import {
  EDITOR_THEME_IDS,
  EDITOR_THEME_PRESETS,
  themePresetPatch,
  type EditorThemeId,
} from "../../lib/editorAppearance";
import { countTextWords } from "../../lib/projectProgress";
import { REVISE_SHORTCUTS } from "../../lib/prompts";
import type { AppSettings } from "../../types";
import type { ProviderConfig } from "../../lib/providerPresets";
import type { StudioMode } from "../../lib/agentChatStore";
import type { VolumeEntry } from "../../lib/volumes";
import { StudioBeatsDrawer } from "./StudioBeatsDrawer";
import { NEXT_STEP, modeLabel, type EditScope } from "./studioShared";

export type StudioEditorPaneProps = {
  mode: StudioMode;
  fileHint: string;
  hint: string;
  err: string;
  fontSize: number;
  lineHeight: number;
  editorBg: string;
  editorFg: string;
  editorTheme: string;
  patchAppear: (partial: Partial<AppSettings>) => void;
  volumeId: string;
  setVolumeId: (id: string) => void;
  volumes: VolumeEntry[];
  chaptersPerVolume: number;
  setChaptersPerVolume: (n: number) => void;
  createNextVolume: () => void;
  chapterId: string;
  chapterTitle: string;
  allChapters: { id: string; title: string; blurb: string }[];
  selectChapter: (id: string, title: string) => void;
  busy: boolean;
  agentBusy: boolean;
  cancel: () => void;
  quickExportTxt: () => void;
  quickZipBackup: () => void;
  chapterBeats: string;
  beatsDrawerOpen: boolean;
  setBeatsDrawerOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  goPrevChapter: () => void;
  goNextChapter: () => void;
  viewMode: "edit" | "preview" | "split";
  setViewMode: (m: "edit" | "preview" | "split") => void;
  findOpen: boolean;
  setFindOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  findQuery: string;
  setFindQuery: (v: string) => void;
  replaceQuery: string;
  setReplaceQuery: (v: string) => void;
  findNext: () => void;
  replaceInDoc: (all: boolean) => void;
  liveSel: { start: number; end: number; text: string } | null;
  editScope: EditScope | null;
  lockSelectionFromEditor: () => void;
  lockWholeDocument: () => void;
  clearEditScope: () => void;
  sendChat: (text?: string) => void;
  loadingDoc: boolean;
  doc: string;
  setDoc: (v: string | ((prev: string) => string)) => void;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  syncLiveSelection: () => void;
  showNextStep: boolean;
  setShowNextStep: (v: boolean) => void;
  projectRoot: string;
  join: (...p: string[]) => Promise<string>;
  settings: AppSettings;
  providers: ProviderConfig[];
  setChapterTitle: (t: string) => void;
  chapterTargetWords: number;
  setChapterTargetWords: (n: number) => void;
  llmReady: boolean;
  onNeedSetup: () => void;
  setHint: (h: string) => void;
  setErr: (e: string) => void;
  setBusy: (b: boolean) => void;
  abortRef: MutableRefObject<AbortController | null>;
  writeChapterRef: MutableRefObject<(() => Promise<void>) | null>;
};

export function StudioEditorPane(p: StudioEditorPaneProps) {
  const {
    mode, fileHint, hint, err, fontSize, lineHeight, editorBg, editorFg, editorTheme,
    patchAppear, volumeId, setVolumeId, volumes, chaptersPerVolume, setChaptersPerVolume,
    createNextVolume, chapterId, chapterTitle, allChapters, selectChapter, busy, agentBusy,
    cancel, quickExportTxt, quickZipBackup, chapterBeats, beatsDrawerOpen, setBeatsDrawerOpen,
    goPrevChapter, goNextChapter, viewMode, setViewMode, findOpen, setFindOpen, findQuery,
    setFindQuery, replaceQuery, setReplaceQuery, findNext, replaceInDoc, liveSel, editScope,
    lockSelectionFromEditor, lockWholeDocument, clearEditScope, sendChat, loadingDoc, doc,
    setDoc, editorRef, syncLiveSelection, showNextStep, setShowNextStep, projectRoot, join,
    settings, providers, setChapterTitle, chapterTargetWords, setChapterTargetWords, llmReady,
    onNeedSetup, setHint, setErr, setBusy, abortRef, writeChapterRef,
  } = p;

  return (
      <section className="studio-editor">
        <div className="studio-editor-bar">
          <div className="studio-editor-title">
            <strong>{modeLabel(mode)}</strong>
            <span className="muted studio-file">{fileHint}</span>
          </div>
          <div className="studio-editor-actions">
            <div className="studio-appear" title="编辑区外观">
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() =>
                  void patchAppear({ editorFontSize: Math.max(12, fontSize - 1) })
                }
              >
                A−
              </button>
              <span className="studio-appear-size">{fontSize}</span>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() =>
                  void patchAppear({ editorFontSize: Math.min(36, fontSize + 1) })
                }
              >
                A+
              </button>
              <select
                value={editorTheme}
                aria-label="配色主题"
                onChange={(e) => {
                  const t = e.target.value as EditorThemeId;
                  void patchAppear(themePresetPatch(t));
                }}
              >
                {EDITOR_THEME_IDS.map((k) => (
                  <option key={k} value={k}>
                    {EDITOR_THEME_PRESETS[k].label}
                  </option>
                ))}
              </select>
              <label className="studio-color" title="背景色（改了会脱离成套）">
                <span>底</span>
                <input
                  type="color"
                  value={editorBg}
                  onChange={(e) => void patchAppear({ editorBgColor: e.target.value })}
                />
              </label>
              <label className="studio-color" title="文字色（改了会脱离成套）">
                <span>字</span>
                <input
                  type="color"
                  value={editorFg}
                  onChange={(e) => void patchAppear({ editorFgColor: e.target.value })}
                />
              </label>
            </div>
            {mode === "beats" && (
              <>
                <select
                  value={volumeId}
                  onChange={(e) => setVolumeId(e.target.value)}
                  aria-label="选择卷"
                >
                  {(volumes.some((v) => v.id === volumeId)
                    ? volumes
                    : [...volumes, { id: volumeId, title: volumeId, chapters: [] }]
                  ).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                      {v.title !== v.id ? ` ${v.title}` : ""}（{v.chapters.length} 章）
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  title="新建下一卷细纲并切换过去"
                  onClick={() => void createNextVolume()}
                >
                  +新建卷
                </button>
                <label className="studio-chapters-n" title="本卷目标章数（一卷通常很多章）">
                  <span>约</span>
                  <input
                    type="number"
                    min={8}
                    max={120}
                    value={chaptersPerVolume}
                    onChange={(e) =>
                      setChaptersPerVolume(
                        Math.max(8, Math.min(120, Number(e.target.value) || 30))
                      )
                    }
                  />
                  <span>章</span>
                </label>
              </>
            )}
            {mode === "chapter" && (
              <select
                value={chapterId}
                onChange={(e) => {
                  const id = e.target.value;
                  const ch = allChapters.find((c) => c.id === id);
                  selectChapter(id, ch?.title || "未命名");
                }}
                aria-label="选择章"
              >
                {(allChapters.length
                  ? allChapters
                  : [{ id: chapterId, title: chapterTitle, blurb: "" }]
                ).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} {c.title}
                  </option>
                ))}
              </select>
            )}
            {(busy || agentBusy) && (
              <button type="button" className="btn btn-ghost btn-compact" onClick={cancel}>
                停止
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              title="导出全书 TXT"
              onClick={() => void quickExportTxt()}
            >
              导出TXT
            </button>
            {window.moshu?.zipProjectBackup && (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                title="备份项目 Zip"
                onClick={() => void quickZipBackup()}
              >
                备份
              </button>
            )}
          </div>
        </div>
        {hint && <div className="studio-status-line">{hint}</div>}
        {mode === "chapter" && (
          <div className="studio-chapter-status">
            <span
              className={`chapter-status-pill ${
                !chapterBeats.trim() ? "warn" : doc.trim() ? "ok" : "todo"
              }`}
            >
              {!chapterBeats.trim() ? "缺细纲" : doc.trim() ? "已写" : "待写"}
            </span>
            <span className="muted">
              {chapterId} {chapterTitle}
              {chapterBeats.trim()
                ? ` · 细纲约 ${countTextWords(chapterBeats)} 字`
                : " · 请先去细纲补本章"}
            </span>
            {chapterBeats.trim() ? (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => setBeatsDrawerOpen((v) => !v)}
              >
                {beatsDrawerOpen ? "收起细纲" : "看细纲"}
              </button>
            ) : (
              <Link className="btn btn-ghost btn-compact" to="/app/beats">
                去细纲
              </Link>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={goPrevChapter}
            >
              上一章
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={goNextChapter}
            >
              下一章
            </button>
          </div>
        )}
        <StudioBeatsDrawer
          open={beatsDrawerOpen}
          beats={chapterBeats}
          onClose={() => setBeatsDrawerOpen(false)}
        />
        <div className="studio-view-tools">
          <button
            type="button"
            className={`btn btn-ghost btn-compact ${viewMode === "edit" ? "active" : ""}`}
            onClick={() => setViewMode("edit")}
          >
            编辑
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-compact ${viewMode === "split" ? "active" : ""}`}
            onClick={() => setViewMode("split")}
          >
            分屏
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-compact ${viewMode === "preview" ? "active" : ""}`}
            onClick={() => setViewMode("preview")}
          >
            预览
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-compact ${findOpen ? "active" : ""}`}
            onClick={() => setFindOpen((v) => !v)}
          >
            查找替换
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            title="把整篇当前稿锁定给 Agent 改"
            onClick={lockWholeDocument}
          >
            整篇交给 Agent
          </button>
        </div>
        {(liveSel || editScope) && (
          <div className={`studio-sel-bar ${editScope ? "locked" : ""}`}>
            {editScope ? (
              <>
                <span className="studio-sel-label">
                  改写范围：{editScope.label}
                  <span className="muted">
                    {" "}
                    · {editScope.text.replace(/\s+/g, "").length} 字
                  </span>
                </span>
                <div className="studio-sel-actions">
                  {REVISE_SHORTCUTS.slice(0, 4).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={agentBusy}
                      onClick={() => void sendChat(s.instruction)}
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={clearEditScope}
                  >
                    取消锁定
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="studio-sel-label">
                  已划选 {liveSel!.text.replace(/\s+/g, "").length} 字
                </span>
                <div className="studio-sel-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    onClick={lockSelectionFromEditor}
                  >
                    锁定给 Agent 改
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() => {
                      lockSelectionFromEditor();
                      window.setTimeout(() => {
                        document.querySelector<HTMLTextAreaElement>(".studio-agent-input")?.focus();
                      }, 30);
                    }}
                  >
                    锁定并去描述
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {findOpen && (
          <div className="studio-find-bar">
            <input
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="查找"
              aria-label="查找"
            />
            <input
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder="替换为"
              aria-label="替换为"
            />
            <button type="button" className="btn btn-ghost btn-compact" onClick={findNext}>
              下一个
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => replaceInDoc(false)}
            >
              替换
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => replaceInDoc(true)}
            >
              全部
            </button>
          </div>
        )}
        {mode === "chapter" && projectRoot && (
          <ChapterTools
            root={projectRoot}
            join={join}
            settings={settings}
            providers={providers}
            chapterId={chapterId}
            chapterTitle={chapterTitle}
            setChapterTitle={setChapterTitle}
            targetWords={chapterTargetWords}
            setTargetWords={setChapterTargetWords}
            doc={doc}
            setDoc={setDoc}
            editorRef={editorRef}
            llmReady={llmReady}
            hasBeats={Boolean(chapterBeats.trim())}
            onNeedSetup={onNeedSetup}
            onHint={setHint}
            onErr={setErr}
            nextChapter={goNextChapter}
            prevChapter={goPrevChapter}
            busy={busy}
            setBusy={setBusy}
            abortRef={abortRef}
            writeChapterRef={writeChapterRef}
          />
        )}
        {loadingDoc ? (
          <div className="studio-loading muted">加载文档…</div>
        ) : !doc.trim() ? (
          <div className="studio-empty-wrap">
            <EmptyGuide
              title={
                mode === "idea"
                  ? "从设定开始"
                  : mode === "outline"
                    ? "总纲还是空的"
                    : mode === "beats"
                      ? "本卷细纲还是空的"
                      : chapterBeats.trim()
                        ? "本章还没有正文"
                        : "先补细纲再写正文"
              }
              steps={
                mode === "idea"
                  ? ["右侧聊聊卖点与世界观", "点「根据对话生成设定」", "再到总纲写全书梗概"]
                  : mode === "outline"
                    ? ["右侧聊全书梗概与分卷", "点生成总纲（不要写第N章）", "再到细纲按卷拆章"]
                    : mode === "beats"
                      ? [
                          "左侧或顶栏选好卷",
                          "可先「章节目录」再补场次",
                          "有章后去正文用「写本章」",
                        ]
                      : chapterBeats.trim()
                        ? [
                            "点中间栏「写本章」（全链路：上章/钩子/KB）",
                            "或右侧先聊再生成（次要）",
                            "写完可抽钩子并切下一章",
                          ]
                        : [
                            "去「细纲」为本卷补本章场次",
                            "回来后优先用「写本章」",
                            "也可先右侧对话构思",
                          ]
              }
              primaryTo={
                mode === "chapter" && !chapterBeats.trim()
                  ? "/app/beats"
                  : NEXT_STEP[mode]?.to
              }
              primaryLabel={
                mode === "chapter" && !chapterBeats.trim()
                  ? "去细纲"
                  : mode === "chapter"
                    ? undefined
                    : NEXT_STEP[mode]?.label
              }
            />
            <textarea
              ref={editorRef}
              className="studio-textarea studio-textarea-empty"
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              onSelect={syncLiveSelection}
              onMouseUp={syncLiveSelection}
              onKeyUp={syncLiveSelection}
              style={{
                backgroundColor: editorBg,
                color: editorFg,
                fontSize,
                lineHeight,
                caretColor: editorFg,
                WebkitTextFillColor: editorFg,
                minHeight: 160,
              }}
              placeholder={
                mode === "idea"
                  ? "或直接在此粘贴设定草稿…"
                  : mode === "outline"
                    ? "或直接在此粘贴总纲…"
                    : mode === "beats"
                      ? "或直接在此粘贴本卷细纲…"
                      : "或直接在此粘贴正文…"
              }
              spellCheck={false}
            />
          </div>
        ) : (
          <div
            className={`studio-doc-pane ${
              viewMode === "split" ? "split" : viewMode === "preview" ? "preview-only" : ""
            }`}
          >
            {viewMode !== "preview" && (
              <textarea
                ref={editorRef}
                className="studio-textarea"
                value={doc}
                onChange={(e) => setDoc(e.target.value)}
                onSelect={syncLiveSelection}
                onMouseUp={syncLiveSelection}
                onKeyUp={syncLiveSelection}
                style={{
                  backgroundColor: editorBg,
                  color: editorFg,
                  fontSize,
                  lineHeight,
                  caretColor: editorFg,
                  WebkitTextFillColor: editorFg,
                }}
                placeholder={
                  mode === "idea"
                    ? "这里只放「设定」草稿（卖点/世界观草案/人物草案）。全书成稿总述去「总纲」，章目录去「细纲」。"
                    : mode === "outline"
                      ? "这里只放「总纲」：卖点、全书梗概、世界观、人物、分卷主题。不要写第N章列表（那是细纲）。"
                      : mode === "beats"
                        ? "这里放本卷细纲：本卷简介 + 很多章的目录 + 各章精简场次。一卷通常二三十章以上。"
                        : "这里放本章正文。章号/标题以细纲为准；生成前请确认右侧提示已载入本章细纲。"
                }
                spellCheck={false}
              />
            )}
            {viewMode !== "edit" && (
              <div
                className="studio-md-preview"
                style={{ backgroundColor: editorBg, color: editorFg, fontSize, lineHeight }}
                dangerouslySetInnerHTML={{
                  __html: marked.parse(doc || "_空文档_", { async: false }) as string,
                }}
              />
            )}
          </div>
        )}
        {showNextStep && NEXT_STEP[mode] && (
          <div className="studio-next-step">
            <span>{NEXT_STEP[mode]!.tip}</span>
            <Link className="btn btn-primary btn-compact" to={NEXT_STEP[mode]!.to}>
              {NEXT_STEP[mode]!.label}
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => setShowNextStep(false)}
            >
              稍后
            </button>
          </div>
        )}
        {err && <div className="studio-err">{err}</div>}
      </section>
  );
}
