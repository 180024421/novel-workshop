import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChapterTools } from "../components/ChapterTools";
import { EmptyGuide } from "../components/EmptyGuide";
import { useAutoSave } from "../hooks/useAutoSave";
import { confirmAction, confirmOverwrite, isAbortError } from "../lib/confirm";
import { loadCharactersMarkdown } from "../lib/characters";
import { syncChapterFileName } from "../lib/chapterFiles";
import { exportBook } from "../lib/exportBook";
import { chatCompletion, humanizeLlmError, type ChatMessage } from "../lib/gateway";
import { checkLicense } from "../lib/license";
import {
  agentSystemPrompt,
  generateFromChatPrompt,
  generateSystemPrompt,
  modeAgentHint,
  modeGenerateButtonLabel,
  modeGenerateListButtonLabel,
  selectionEditSystemAddon,
  REVISE_SHORTCUTS,
} from "../lib/prompts";
import {
  applyEditorAppearance,
  EDITOR_THEME_IDS,
  EDITOR_THEME_PRESETS,
  resolveEditorColors,
  themePresetPatch,
  type EditorThemeId,
} from "../lib/editorAppearance";
import { countTextWords } from "../lib/projectProgress";
import { addUsage } from "../lib/usageLedger";
import { estimateCostCny, loadPrices, pickPrice } from "../lib/costEstimate";
import { runWritePipeline } from "../lib/writePipeline";
import { resolveChapterTargetWords } from "../lib/writePipelineUtils";
import type { AppSettings } from "../types";
import {
  clearAgentThread,
  chatScope,
  loadAgentThread,
  saveAgentThread,
  type AgentMsg,
  type StudioMode,
} from "../lib/agentChatStore";
import {
  ensureVolumeBeatsFile,
  findVolumeForChapter,
  loadChapterBeatsText,
  loadProjectVolumes,
  volumeBeatsPath,
  type VolumeEntry,
} from "../lib/volumes";
import { useApp } from "../state/AppContext";
import { marked } from "marked";

export type { StudioMode };

const NEXT_STEP: Record<
  StudioMode,
  { label: string; to: string; tip: string } | null
> = {
  idea: { label: "去写总纲", to: "/app/outline", tip: "设定就绪后，用总纲写全书梗概与分卷主题" },
  outline: { label: "去写细纲", to: "/app/beats", tip: "总纲就绪后，按卷写章节目录与场次" },
  beats: { label: "去写正文", to: "/app/chapter", tip: "细纲有章后，用「写本章」生成正文" },
  chapter: null,
};

function modeFromPath(pathname: string): StudioMode {
  if (pathname.includes("/outline")) return "outline";
  if (pathname.includes("/beats")) return "beats";
  if (pathname.includes("/chapter")) return "chapter";
  return "idea";
}

function modeLabel(mode: StudioMode) {
  if (mode === "idea") return "设定";
  if (mode === "outline") return "总纲";
  if (mode === "beats") return "细纲（按卷）";
  return "正文";
}

const EMPTY_VOLUMES: VolumeEntry[] = [{ id: "第1卷", title: "第1卷", chapters: [] }];

function extractMarkdownBlock(text: string): string | null {
  const m = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  return null;
}

function stripFences(text: string) {
  const inner = extractMarkdownBlock(text);
  return inner ?? text.trim();
}

type EditScope = {
  kind: "selection" | "document";
  start: number;
  end: number;
  text: string;
  label: string;
};

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

  const [doc, setDoc] = useState("");
  const [seed, setSeed] = useState("");
  const [outline, setOutline] = useState("");
  const [bible, setBible] = useState("");
  const [style, setStyle] = useState("");
  const [volumes, setVolumes] = useState<VolumeEntry[]>(EMPTY_VOLUMES);
  /** 细纲：本卷目标章数（网文一卷通常很多章） */
  const [chaptersPerVolume, setChaptersPerVolume] = useState(30);
  /** 正文页：当前章对应的细纲摘录 */
  const [chapterBeats, setChapterBeats] = useState("");
  const [chapterTargetWords, setChapterTargetWords] = useState(
    settings.defaultChapterWords ?? 2500
  );
  const [hint, setHint] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const [input, setInput] = useState("");
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [showNextStep, setShowNextStep] = useState(false);
  const [beatsDrawerOpen, setBeatsDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "preview" | "split">("edit");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [editScope, setEditScope] = useState<EditScope | null>(null);
  const [liveSel, setLiveSel] = useState<{ start: number; end: number; text: string } | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const skipSaveRef = useRef(true);
  const chatHydratedRef = useRef(false);
  const chatScopeRef = useRef("");
  const writeChapterRef = useRef<(() => Promise<void>) | null>(null);
  const generateFromChatRef = useRef<
    ((replace?: boolean, beatsPhase?: "list" | "full") => Promise<void>) | null
  >(null);

  const currentVolume: VolumeEntry | null =
    volumes.find((v) => v.id === volumeId) || volumes[0] || null;

  const license = useMemo(() => checkLicense(settings), [settings]);
  const [genBlocked, setGenBlocked] = useState<{ maintenance: boolean; forceUpdate: boolean; reason: string }>({
    maintenance: false,
    forceUpdate: false,
    reason: "",
  });
  useEffect(() => {
    void (async () => {
      try {
        const meta = await window.moshu?.getCachedAppMeta?.();
        const st = await window.moshu?.getUpdateStatus?.();
        const s = st as { forceUpdate?: boolean; probe?: { forceUpdate?: boolean } };
        const maintenance = Boolean(meta?.maintenance?.enabled);
        const forceUpdate = Boolean(s?.forceUpdate || s?.probe?.forceUpdate);
        setGenBlocked({
          maintenance,
          forceUpdate,
          reason: maintenance
            ? meta?.maintenance?.message || "维护模式中"
            : forceUpdate
              ? "需要强制更新"
              : "",
        });
      } catch {
        /* ignore */
      }
    })();
  }, [settings]);
  const generateDisabled = useMemo(
    () =>
      busy ||
      agentBusy ||
      !messages.length ||
      !license.ok ||
      genBlocked.maintenance ||
      genBlocked.forceUpdate,
    [busy, agentBusy, messages.length, license.ok, genBlocked]
  );

  const refreshVolumes = useCallback(
    async (outlineOverride?: string) => {
      if (!project || !window.moshu) return EMPTY_VOLUMES;
      const vols = await loadProjectVolumes({
        root: project.root,
        join,
        outline: outlineOverride ?? outline,
      });
      setVolumes(vols.length ? vols : EMPTY_VOLUMES);
      return vols.length ? vols : EMPTY_VOLUMES;
    },
    [project, join, outline]
  );

  const scopeKey = chatScope(mode, volumeId, chapterId);
  chatScopeRef.current = scopeKey;

  const fileHint = useMemo(() => {
    if (mode === "idea") return "bible/world.md";
    if (mode === "outline") return "outlines/outline.md";
    if (mode === "beats") return `beats/${volumeBeatsPath(volumeId)}`;
    return `chapters/${chapterId}_….md`;
  }, [mode, volumeId, chapterId]);

  // 加载共享上下文 + 当前文档
  useEffect(() => {
    if (!project || !window.moshu) return;
    let cancelled = false;
    (async () => {
      setLoadingDoc(true);
      setErr("");
      skipSaveRef.current = true;
      chatHydratedRef.current = false;
      const w = window.moshu!;
      try {
        const [seedT, bibleT, styleT, outlineT] = await Promise.all([
          w.readText(await join(project.root, "ideas", "seed.md")),
          w.readText(await join(project.root, "bible", "world.md")),
          w.readText(await join(project.root, "prompts", "style.md")),
          w.readText(await join(project.root, "outlines", "outline.md")),
        ]);
        if (cancelled) return;
        setSeed(seedT);
        setBible(bibleT);
        setStyle(styleT);
        setOutline(outlineT);

        const vols = await loadProjectVolumes({
          root: project.root,
          join,
          outline: outlineT,
        });
        setVolumes(vols.length ? vols : EMPTY_VOLUMES);
        let vid = vols[0]?.id || "第1卷";
        const hit = findVolumeForChapter(vols, chapterId);
        if (hit) vid = hit.id;
        if (mode === "chapter") setVolumeId(vid);

        let text = "";
        if (mode === "idea") {
          text = bibleT.trim() ? bibleT : seedT;
        } else if (mode === "outline") {
          text = outlineT;
        } else if (mode === "beats") {
          // 优先用上下文里的当前卷（侧栏切换），否则用解析到的卷
          if (volumeId && /^第\d+卷$/.test(volumeId)) vid = volumeId;
          setVolumeId(vid);
          const ensured = await ensureVolumeBeatsFile({
            root: project.root,
            join,
            volumeId: vid,
          });
          text = ensured.text;
          if (ensured.created) {
            const vol = vols.find((v) => v.id === vid) || vols[0];
            const parts: string[] = [];
            if (vol) {
              for (const c of vol.chapters) {
                const legacy = await w.readText(
                  await join(project.root, "beats", `${c.id}.md`)
                );
                if (legacy.trim()) {
                  parts.push(
                    legacy.trim().startsWith("#")
                      ? legacy.trim()
                      : `## ${c.id} ${c.title}\n\n${legacy.trim()}`
                  );
                }
              }
            }
            if (parts.length) {
              text = `${ensured.text.trim()}\n\n${parts.join("\n\n")}`;
              await w.writeText(
                await join(project.root, "beats", volumeBeatsPath(vid)),
                text
              );
            }
          } else if (!text.trim()) {
            text = ensured.text;
          }
        } else {
          const files = await w.listDir(await join(project.root, "chapters"));
          const chFile = files.find(
            (f) => f.name === `${chapterId}.md` || f.name.startsWith(`${chapterId}_`)
          );
          text = chFile ? await w.readText(chFile.path) : "";
          const ch = vols.flatMap((v) => v.chapters).find((c) => c.id === chapterId);
          if (ch?.title && ch.title !== "未命名") {
            setChapterTitle(ch.title);
          } else if (ch?.title) {
            setChapterTitle(ch.title);
          }
          const hitVol = findVolumeForChapter(vols, chapterId);
          if (hitVol) setVolumeId(hitVol.id);
          const beatsLoaded = await loadChapterBeatsText({
            root: project.root,
            join,
            chapterId,
            volumeId: hitVol?.id,
            outline: outlineT,
          });
          setChapterBeats(beatsLoaded.text);
        }
        if (cancelled) return;
        setDoc(text);
        chatHydratedRef.current = false;
        const thread = await loadAgentThread({
          root: project.root,
          join,
          mode,
          scope: chatScope(mode, vid, chapterId),
        });
        if (cancelled) return;
        setMessages(thread);
        chatHydratedRef.current = true;
        setHint(thread.length ? `已恢复 ${thread.length} 条对话` : "");
      } finally {
        if (!cancelled) {
          setLoadingDoc(false);
          window.setTimeout(() => {
            skipSaveRef.current = false;
          }, 50);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // volume 切换由下方 effect 处理（仅 beats）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.root, mode, chapterId, join, setChapterTitle]);

  // 细纲：用户手动换卷时重载
  const lastVolRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "beats" || !project || !window.moshu) return;
    if (lastVolRef.current === null) {
      lastVolRef.current = volumeId;
      return;
    }
    if (lastVolRef.current === volumeId) return;
    lastVolRef.current = volumeId;
    let cancelled = false;
    (async () => {
      setLoadingDoc(true);
      skipSaveRef.current = true;
      try {
        let text = await window.moshu!.readText(
          await join(project.root, "beats", volumeBeatsPath(volumeId))
        );
        if (!text.trim()) {
          const ensured = await ensureVolumeBeatsFile({
            root: project.root,
            join,
            volumeId,
          });
          text = ensured.text;
          const vols = await loadProjectVolumes({
            root: project.root,
            join,
            outline,
          });
          setVolumes(vols.length ? vols : EMPTY_VOLUMES);
          if (ensured.created) {
            const vol = vols.find((v) => v.id === volumeId);
            const parts: string[] = [];
            if (vol) {
              for (const c of vol.chapters) {
                const legacy = await window.moshu!.readText(
                  await join(project.root, "beats", `${c.id}.md`)
                );
                if (legacy.trim()) {
                  parts.push(
                    legacy.trim().startsWith("#")
                      ? legacy.trim()
                      : `## ${c.id} ${c.title}\n\n${legacy.trim()}`
                  );
                }
              }
            }
            if (parts.length) {
              text = `${ensured.text.trim()}\n\n${parts.join("\n\n")}`;
              await window.moshu!.writeText(
                await join(project.root, "beats", volumeBeatsPath(volumeId)),
                text
              );
            }
          }
        }
        if (cancelled) return;
        setDoc(text);
        chatHydratedRef.current = false;
        const thread = await loadAgentThread({
          root: project.root,
          join,
          mode: "beats",
          scope: volumeId,
        });
        if (cancelled) return;
        setMessages(thread);
        chatHydratedRef.current = true;
      } finally {
        if (!cancelled) {
          setLoadingDoc(false);
          window.setTimeout(() => {
            skipSaveRef.current = false;
          }, 50);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [volumeId, mode, project, join, outline]);

  // 切模式时重置卷跟踪，避免误触发
  useEffect(() => {
    lastVolRef.current = null;
  }, [mode, project?.root]);

  useEffect(() => {
    setShowNextStep(false);
    setBeatsDrawerOpen(false);
    setFindOpen(false);
    setEditScope(null);
    setLiveSel(null);
  }, [mode, project?.root, chapterId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentBusy]);

  useEffect(() => {
    if (!project || loadingDoc || !chatHydratedRef.current) return;
    const root = project.root;
    const modeSnap = mode;
    const scopeSnap = scopeKey;
    const msgs = messages;
    const t = window.setTimeout(() => {
      // 切会话中途不要把空数组写进别的 thread
      if (chatScopeRef.current !== scopeSnap) return;
      void saveAgentThread({
        root,
        join,
        mode: modeSnap,
        scope: scopeSnap,
        messages: msgs,
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [messages, project, mode, scopeKey, loadingDoc, join]);

  useAutoSave(
    doc,
    async (v) => {
      if (!project || !window.moshu || loadingDoc || skipSaveRef.current) return;
      if (mode === "idea") {
        await window.moshu.writeText(await join(project.root, "bible", "world.md"), v);
        setBible(v);
        setHint("设定已自动保存");
      } else if (mode === "outline") {
        await window.moshu.writeText(await join(project.root, "outlines", "outline.md"), v);
        setOutline(v);
        setHint("总纲已自动保存");
      } else if (mode === "beats") {
        await window.moshu.writeText(
          await join(project.root, "beats", volumeBeatsPath(volumeId)),
          v
        );
        void refreshVolumes();
        setHint("本卷细纲已自动保存");
      } else {
        await syncChapterFileName({
          root: project.root,
          join,
          chapterId,
          title: chapterTitle,
          body: v,
        });
        setHint("正文已自动保存");
      }
    },
    700,
    `${mode}:${scopeKey}`
  );

  const saveNow = useCallback(async () => {
    if (!project || !window.moshu || loadingDoc) return;
    const v = doc;
    if (mode === "idea") {
      await window.moshu.writeText(await join(project.root, "bible", "world.md"), v);
      setBible(v);
      setHint("设定已保存");
    } else if (mode === "outline") {
      await window.moshu.writeText(await join(project.root, "outlines", "outline.md"), v);
      setOutline(v);
      setHint("总纲已保存");
    } else if (mode === "beats") {
      await window.moshu.writeText(
        await join(project.root, "beats", volumeBeatsPath(volumeId)),
        v
      );
      void refreshVolumes();
      setHint("本卷细纲已保存");
    } else {
      await syncChapterFileName({
        root: project.root,
        join,
        chapterId,
        title: chapterTitle,
        body: v,
      });
      setHint("正文已保存");
    }
  }, [
    project,
    loadingDoc,
    doc,
    mode,
    join,
    volumeId,
    chapterId,
    chapterTitle,
    refreshVolumes,
  ]);

  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  function cancel() {
    abortRef.current?.abort();
  }

  function syncLiveSelection() {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) {
      setLiveSel(null);
      return;
    }
    setLiveSel({ start, end, text: doc.slice(start, end) });
  }

  function lockSelectionFromEditor() {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) {
      setErr("请先在中间编辑器划选要改的文字");
      return;
    }
    const text = doc.slice(start, end);
    setEditScope({
      kind: "selection",
      start,
      end,
      text,
      label: `选区 ${text.replace(/\s+/g, "").length} 字`,
    });
    setLiveSel(null);
    setHint("已锁定选区：在右侧描述如何改，Agent 会按选区改写");
    setErr("");
  }

  function lockWholeDocument() {
    if (!doc.trim()) {
      setErr("编辑器还是空的，先写一点或生成草稿再改");
      return;
    }
    setEditScope({
      kind: "document",
      start: 0,
      end: doc.length,
      text: doc,
      label: `整篇${modeLabel(mode)}`,
    });
    setHint(`已锁定整篇${modeLabel(mode)}：描述要怎么改即可`);
    setErr("");
  }

  function clearEditScope() {
    setEditScope(null);
    setHint("已取消改写范围");
  }

  function resolveEditRange(scope: EditScope): { start: number; end: number } | null {
    if (scope.kind === "document") {
      return { start: 0, end: doc.length };
    }
    const slice = doc.slice(scope.start, scope.end);
    if (slice === scope.text) return { start: scope.start, end: scope.end };
    const idx = doc.indexOf(scope.text);
    if (idx >= 0) return { start: idx, end: idx + scope.text.length };
    return null;
  }

  function applyToEditor(text: string, replace: boolean) {
    const body = stripFences(text);
    if (!body) {
      setErr("没有可写入的正文");
      return;
    }
    if (editScope) {
      const range = resolveEditRange(editScope);
      if (!range) {
        setErr("锁定文本已变动，请重新划选锁定后再替换");
        return;
      }
      const next = doc.slice(0, range.start) + body + doc.slice(range.end);
      setDoc(next);
      const newEnd = range.start + body.length;
      setEditScope({
        ...editScope,
        start: range.start,
        end: newEnd,
        text: body,
        label:
          editScope.kind === "document"
            ? editScope.label
            : `选区 ${body.replace(/\s+/g, "").length} 字`,
      });
      setHint("已替换锁定范围");
      window.setTimeout(() => {
        editorRef.current?.focus();
        editorRef.current?.setSelectionRange(range.start, newEnd);
      }, 0);
      return;
    }
    if (replace && doc.trim() && !confirmOverwrite("中间编辑器内容")) return;
    setDoc((prev) => (replace || !prev.trim() ? body : `${prev.trim()}\n\n${body}`));
    setHint(replace ? "已写入中间编辑器" : "已追加到编辑器末尾");
    editorRef.current?.focus();
  }

  async function sendChat(userText?: string) {
    const text = (userText ?? input).trim();
    if (!text || !project) return;
    if (!llmReady) {
      nav("/setup");
      return;
    }
    setInput("");
    setErr("");
    const nextMsgs: AgentMsg[] = [...messages, { role: "user", content: text }];
    setMessages(nextMsgs);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setAgentBusy(true);

    // 若用户刚划选了但还没点锁定，发送时自动锁定
    let scope = editScope;
    if (!scope && editorRef.current) {
      const start = editorRef.current.selectionStart;
      const end = editorRef.current.selectionEnd;
      if (end > start) {
        const selText = doc.slice(start, end);
        scope = {
          kind: "selection",
          start,
          end,
          text: selText,
          label: `选区 ${selText.replace(/\s+/g, "").length} 字`,
        };
        setEditScope(scope);
      }
    }

    let charactersBrief = "";
    if (mode === "chapter") {
      try {
        const fromFiles = await loadCharactersMarkdown(project.root, join);
        charactersBrief = (fromFiles || bible).slice(0, 2500);
      } catch {
        charactersBrief = bible.slice(0, 1500);
      }
    }

    const metaParts = [
      `当前页面固定为：${modeLabel(mode)}（生成结果也必须是「${modeLabel(mode)}」，不要写成其他阶段的稿）`,
      mode === "idea"
        ? "提醒：若用户要全书总述，引导去「总纲」；若要章目录/分卷章节，引导去「细纲」。本页只产出设定草稿。"
        : "",
      mode === "outline"
        ? "提醒：总纲只要全书梗概、世界观、人物、分卷主题；禁止第N章列表（那是细纲）。"
        : "",
      mode === "beats"
        ? `当前卷：${volumeId} ${currentVolume?.title || ""}；目标约 ${chaptersPerVolume} 章（一卷应有很多章）`
        : "",
      mode === "chapter" ? `当前章：${chapterId} ${chapterTitle}` : "",
      mode === "chapter"
        ? `本章细纲（必须以它为准写正文）：\n${chapterBeats.slice(0, 3500) || "（细纲里还没有这一章，请先去「细纲」补章）"}`
        : "",
      mode === "chapter" && charactersBrief
        ? `人物声口摘录（对白对照用）：\n${charactersBrief}`
        : "",
      `编辑器摘要：\n${doc.slice(0, 2500) || "（空）"}`,
      mode !== "idea" ? `设定摘要：\n${bible.slice(0, 2000)}` : "",
      mode === "beats" || mode === "chapter"
        ? `总纲摘要：\n${outline.slice(0, 2500)}`
        : "",
      seed.trim() ? `原始想法：\n${seed.slice(0, 800)}` : "",
    ];

    if (scope) {
      const before = doc.slice(Math.max(0, scope.start - 1200), scope.start);
      const after = doc.slice(scope.end, scope.end + 1200);
      metaParts.push(
        selectionEditSystemAddon({
          kind: scope.kind,
          label: modeLabel(mode),
          text: scope.text,
          before,
          after,
        })
      );
    }

    const meta = metaParts.filter(Boolean).join("\n\n");

    const apiMessages: ChatMessage[] = [
      { role: "system", content: agentSystemPrompt(mode, meta) },
      ...nextMsgs.map((m) => ({ role: m.role, content: m.content })),
    ];

    let assistant = "";
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    try {
      assistant = await chatCompletion(settings, apiMessages, {
        providers,
        model: settings.routeOutline || settings.routeChapter || "小说",
        stream: true,
        signal: ac.signal,
        onDelta: (d) => {
          assistant += d;
          const snap = assistant;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: snap };
            return copy;
          });
        },
      });
      if (!String(assistant || "").trim()) {
        setMessages((prev) => prev.slice(0, -1));
        setErr("Agent 没有返回内容，请检查引擎 Key / 模型后重试");
        return;
      }
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: assistant };
        return copy;
      });
      setHint(
        scope
          ? "可点回复下的「替换锁定范围」把改稿写回选区"
          : "可点「写入编辑器」把回复中的 Markdown 落到中间"
      );
      try {
        const prices = await loadPrices(join);
        const enabled = providers.find((p) => p.enabled && p.apiKey.trim());
        const price = pickPrice(prices, enabled?.id);
        await addUsage({
          words: 0,
          costCny: estimateCostCny(
            Math.min(text.length + meta.length, 8000),
            assistant.length,
            price.cnyPer1k
          ),
        });
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (isAbortError(e)) setHint("已取消");
      else {
        setErr(humanizeLlmError(e));
        setMessages((prev) => prev.slice(0, -1));
      }
    } finally {
      setAgentBusy(false);
      abortRef.current = null;
    }
  }

  async function generateFromChat(
    replace = true,
    beatsPhase: "list" | "full" = "full"
  ) {
    if (!project) return;
    if (!license.ok) {
      setErr(license.reason || "试用已到期，请到设置填写授权码");
      return;
    }
    if (!llmReady) {
      nav("/setup");
      return;
    }
    if (!messages.length) {
      setErr("请先在右侧和 AI 聊聊构想");
      return;
    }
    if (mode === "chapter" && !chapterBeats.trim()) {
      setErr("细纲里还没有本章场次，请先在「细纲」写好对应章节，再生成正文");
      return;
    }
    if (replace && doc.trim() && !confirmOverwrite(`${modeLabel(mode)}草稿`)) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setShowNextStep(false);
    setErr("");
    setHint(
      mode === "beats" && beatsPhase === "list"
        ? `正在生成本卷约 ${chaptersPerVolume} 章的目录…`
        : "正在根据对话生成到编辑器…"
    );

    let charactersBrief = "";
    if (mode === "chapter") {
      try {
        const fromFiles = await loadCharactersMarkdown(project.root, join);
        charactersBrief = (fromFiles || "").slice(0, 3000);
      } catch {
        charactersBrief = "";
      }
    }

    const transcript = messages
      .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content}`)
      .join("\n\n");
    const context = [
      seed && `原始想法：\n${seed}`,
      bible && `设定：\n${bible.slice(0, 6000)}`,
      outline && `总纲：\n${outline.slice(0, 8000)}`,
      style && `风格：\n${style}`,
      mode === "beats"
        ? `本卷目标章数：约 ${chaptersPerVolume} 章（一卷应有很多章，不要只排几章）`
        : "",
      mode === "beats" && currentVolume
        ? `本卷已有章节：\n${
            currentVolume.chapters.map((c) => `${c.id} ${c.title}`).join("\n") ||
            "（尚无）"
          }`
        : "",
      mode === "chapter" ? `章：${chapterId} ${chapterTitle}` : "",
      mode === "chapter"
        ? `本章细纲（正文必须按此展开，不要另起炉灶）：\n${chapterBeats.slice(0, 8000)}`
        : "",
      mode === "chapter" && charactersBrief
        ? `人物声口（对白需贴合）：\n${charactersBrief}`
        : "",
      doc.trim() ? `当前编辑器草稿（可参考改写）：\n${doc.slice(0, 4000)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    let out = "";
    try {
      if (mode === "chapter") {
        const targetWords = resolveChapterTargetWords(
          transcript,
          chapterTargetWords,
          settings.defaultChapterWords
        );
        if (targetWords !== chapterTargetWords) setChapterTargetWords(targetWords);
        const result = await runWritePipeline({
          root: project.root,
          join,
          chapterId,
          chapterTitle,
          settings,
          providers,
          targetWords,
          signal: ac.signal,
          persist: true,
          onProgress: (progress) => {
            setHint(progress.label);
            if (progress.bodySoFar != null) setDoc(progress.bodySoFar);
          },
        });
        setDoc(result.body);
        setHint(
          `已生成到中间编辑器（约 ${result.words} 字，达标率 ${Math.round(
            result.ratio * 100
          )}%）`
        );
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: `已根据对话通过正文流水线写入中间编辑器。\n终检：${result.words}/${result.targetWords} 字（${Math.round(
              result.ratio * 100
            )}%），补写 ${result.continueRounds} 轮${
              result.beatsReport.trim() ? "，细纲自检已完成" : ""
            }。`,
          },
        ]);
        return;
      }
      out = await chatCompletion(
        settings,
        [
          { role: "system", content: generateSystemPrompt(mode) },
          {
            role: "user",
            content: generateFromChatPrompt({
              mode,
              transcript,
              context,
              chaptersPerVolume,
              beatsPhase: mode === "beats" ? beatsPhase : undefined,
            }),
          },
        ],
        {
          providers,
          model: settings.routeOutline || settings.routeChapter || "小说",
          stream: true,
          signal: ac.signal,
          onDelta: (d) => {
            out += d;
            setDoc(stripFences(out));
          },
        }
      );
      const final = stripFences(out);
      const nextDoc = replace ? final : doc.trim() ? `${doc.trim()}\n\n${final}` : final;
      setDoc(nextDoc);
      if (mode === "outline") setOutline(nextDoc);
      if (mode === "beats") void refreshVolumes();
      setHint(`已生成到中间编辑器（约 ${countTextWords(final)} 字）`);
      if (NEXT_STEP[mode]) setShowNextStep(true);
      try {
        const prices = await loadPrices(join);
        const enabled = providers.find((p) => p.enabled && p.apiKey.trim());
        const price = pickPrice(prices, enabled?.id);
        const w = countTextWords(final);
        await addUsage({
          words: 0,
          costCny: estimateCostCny(Math.min(transcript.length + context.length, 12000), w, price.cnyPer1k),
        });
      } catch {
        /* ignore */
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            mode === "beats" && beatsPhase === "list"
              ? `已生成本卷章节目录（目标约 ${chaptersPerVolume} 章）。可再点「${modeGenerateButtonLabel(
                  "beats"
                )}」补场次，或继续改目录。`
              : `已根据对话生成${modeLabel(mode)}并写入中间编辑器。你可继续改稿，或再说修改意见。`,
        },
      ]);
    } catch (e) {
      if (isAbortError(e)) setHint("已取消生成");
      else setErr(humanizeLlmError(e));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  generateFromChatRef.current = generateFromChat;

  useEffect(() => {
    const onHotkey = (ev: Event) => {
      const action = (ev as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "save") {
        void saveNowRef.current?.();
        return;
      }
      if (action === "findInDoc") {
        setFindOpen(true);
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>(".studio-find-bar input")?.focus();
        }, 30);
        return;
      }
      if (action !== "generate") return;
      if (busy || agentBusy) return;
      if (mode === "chapter") {
        void writeChapterRef.current?.();
        return;
      }
      if (!messages.length || !license.ok) return;
      void generateFromChatRef.current?.(true, "full");
    };
    window.addEventListener("moshu:hotkey", onHotkey);
    return () => window.removeEventListener("moshu:hotkey", onHotkey);
  }, [mode, busy, agentBusy, messages.length, license.ok]);

  // 书内搜索跳转：定位行并打开查找
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

  function clearChat() {
    if (messages.length && !confirmAction("确定清空当前页的 Agent 对话？")) return;
    setMessages([]);
    if (project) {
      void clearAgentThread({
        root: project.root,
        join,
        mode,
        scope: scopeKey,
      });
    }
  }

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

  function goNextChapter() {
    ctxNextChapter();
  }

  function goPrevChapter() {
    ctxPrevChapter();
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
    // 若列表里还没有（刚建的），手动补上
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
  const allChapters = (() => {
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
  })();
  const fontSize = settings.editorFontSize || 16;
  const lineHeight = settings.editorLineHeight || 1.75;
  const { bg: editorBg, fg: editorFg, theme: editorTheme } = resolveEditorColors(settings);

  async function patchAppear(partial: Partial<AppSettings>) {
    const next = { ...settings, ...partial };
    applyEditorAppearance(next);
    await patchSettings(partial);
  }

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
        {mode === "chapter" && beatsDrawerOpen && chapterBeats.trim() && (
          <div className="studio-beats-drawer">
            <div className="studio-beats-drawer-head">
              <strong>本章细纲</strong>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => setBeatsDrawerOpen(false)}
              >
                关闭
              </button>
            </div>
            <pre className="studio-beats-drawer-body">{chapterBeats}</pre>
          </div>
        )}
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
        {mode === "chapter" && project && (
          <ChapterTools
            root={project.root}
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
            onNeedSetup={() => nav("/setup")}
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

      <aside className="studio-agent">
        <div className="studio-agent-head">
          <div>
            <strong>Agent</strong>
            <span className="muted"> {modeAgentHint(mode)}</span>
            {editScope && (
              <span className="studio-agent-scope"> · 改「{editScope.label}」</span>
            )}
          </div>
          <button type="button" className="btn btn-ghost btn-compact" onClick={clearChat}>
            清空对话
          </button>
        </div>

        <div className="studio-agent-msgs">
          {messages.length === 0 && (
            <div className="studio-agent-empty">
              <p>
                当前在「{modeLabel(mode)}」页：右侧对话、中间只落{modeLabel(mode)}稿。
              </p>
              <ul>
                {mode === "idea" && (
                  <>
                    <li>本页产出：设定草稿（卖点/世界观/人物/禁忌）</li>
                    <li>全书总述去「总纲」；章目录与卷简介去「细纲」</li>
                  </>
                )}
                {mode === "outline" && (
                  <>
                    <li>本页产出：总纲（梗概 / 世界观 / 人物 / 分卷主题）</li>
                    <li>不要写第N章列表；分章去「细纲」，正文去「正文」</li>
                  </>
                )}
                {mode === "beats" && (
                  <>
                    <li>细纲按卷：每一卷一份（本卷简介 + 章节 + 场次）</li>
                    <li>
                      左侧「卷目录」或顶栏切换卷；点「+新建卷」开第 N 卷
                    </li>
                    <li>一卷默认约 {chaptersPerVolume} 章；可先「章节目录」再补场次</li>
                  </>
                )}
                {mode === "chapter" && (
                  <>
                    <li>本页产出：本章正文（章目录以细纲为准）</li>
                    <li>
                      {chapterBeats.trim()
                        ? "已载入本章细纲；优先用中间栏「写本章」（全链路：钩子/上章/KB）"
                        : "⚠ 细纲里还没有本章，请先去「细纲」补章"}
                    </li>
                    <li>
                      像 Cursor 一样：中间划选一段 →「锁定给 Agent 改」→ 右侧描述如何改 →「替换锁定范围」
                    </li>
                    <li>也可点「整篇交给 Agent」对整章描述调整</li>
                  </>
                )}
                <li>
                  {mode === "chapter"
                    ? "写章请用中间栏「写本章」；局部改稿用选区锁定"
                    : `聊清楚后点下方「${modeGenerateButtonLabel(mode)}」；也可划选局部让 Agent 改`}
                </li>
              </ul>
              <div className="studio-quick">
                {mode === "idea" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void sendChat("帮我梳理卖点、世界观规则、主角与核心冲突（不要写章节正文）")}
                    >
                      梳理卖点与冲突
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendChat("主要人物各是什么身份与声口？人物之间有哪些张力？（仍停留在设定层）")}
                    >
                      聊人物张力
                    </button>
                  </>
                )}
                {mode === "outline" && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          "帮我写全书总纲：卖点、梗概、世界观、主要人物、主线冲突、分卷主题（禁止输出第N章列表）"
                        )
                      }
                    >
                      梳理全书总纲
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendChat("各卷主题弧线怎么排？每卷一句话即可，不要拆章。")}
                    >
                      聊分卷主题
                    </button>
                  </>
                )}
                {mode === "beats" && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          `「${volumeId}」按网文一卷来排，目标约 ${chaptersPerVolume} 章：先聊本卷简介、开卷钩子、中段升级、卷末高潮（先别写正文）`
                        )
                      }
                    >
                      聊本卷骨架
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          `请按约 ${chaptersPerVolume} 章规划本卷目录（要很多章，不要只给几章）。已有：${
                            (currentVolume?.chapters || []).map((c) => c.id).join("、") || "（尚无）"
                          }`
                        )
                      }
                    >
                      聊章目录（多章）
                    </button>
                  </>
                )}
                {mode === "chapter" && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          `先聊「${chapterId} ${chapterTitle}」这一章要达成什么情绪与冲突，不要直接写正文`
                        )
                      }
                    >
                      聊本章目标
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendChat("这一章对白想偏什么样的声口？")}
                    >
                      聊声口
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          "请对照本章细纲做连贯检查：场次是否落全、情绪弧是否断裂、有无跑偏细纲；列出问题并给改写建议（先别整章重写）。"
                        )
                      }
                    >
                      对照细纲检查
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          "请按人物声口卡，挑一处对白改得更贴身份与性格；说明改了谁、为何更贴，并给出改写后的一小段。"
                        )
                      }
                    >
                      按人物声口改一处
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`studio-msg ${m.role}`}>
              <div className="studio-msg-role">{m.role === "user" ? "你" : "Agent"}</div>
              <div className="studio-msg-body">
                {m.content || (agentBusy && i === messages.length - 1 ? "…" : "")}
              </div>
              {m.role === "assistant" && m.content.trim() && (
                <div className="studio-msg-actions">
                  {editScope ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      onClick={() => applyToEditor(m.content, true)}
                    >
                      替换锁定范围
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="linkish studio-msg-apply"
                    onClick={() => applyToEditor(m.content, !doc.trim())}
                  >
                    {doc.trim() ? "写入编辑器" : "写入编辑器"}
                  </button>
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="studio-agent-foot">
          <div className="studio-agent-tools">
            {mode === "beats" && (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                disabled={generateDisabled}
                onClick={() => void generateFromChat(true, "list")}
                title={
                  !license.ok
                    ? license.reason
                    : `先落约 ${chaptersPerVolume} 章的目录，再补场次更稳`
                }
              >
                {busy ? "生成中…" : modeGenerateListButtonLabel()}
              </button>
            )}
            <button
              type="button"
              className={`btn btn-compact ${
                mode === "chapter" ? "btn-ghost" : "btn-primary"
              }`}
              disabled={generateDisabled}
              title={
                !license.ok
                  ? license.reason
                  : mode === "chapter"
                    ? "对话改稿后再生成；写新章请优先用中间栏「写本章」"
                    : undefined
              }
              onClick={() => void generateFromChat(true, "full")}
            >
              {busy ? "生成中…" : modeGenerateButtonLabel(mode)}
            </button>
            {lastAssistant?.content.trim() && (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                disabled={busy || agentBusy}
                onClick={() => applyToEditor(lastAssistant.content, true)}
              >
                用最近回复覆盖
              </button>
            )}
          </div>
          <textarea
            className="studio-agent-input"
            rows={3}
            value={input}
            disabled={agentBusy}
            placeholder={
              editScope
                ? `描述如何改「${editScope.label}」… Enter 发送`
                : mode === "idea"
                  ? "聊设定草稿…（全书总述→总纲；章目录→细纲）Enter 发送"
                  : mode === "outline"
                    ? "聊总纲：梗概/世界观/人物/分卷主题… Enter 发送"
                    : mode === "beats"
                      ? "聊本卷简介与章节细纲… Enter 发送"
                      : "聊本章正文，或先划选一段再描述怎么改… Enter 发送"
            }
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendChat();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={agentBusy || !input.trim()}
            onClick={() => void sendChat()}
          >
            {agentBusy ? "思考中…" : "发送"}
          </button>
        </div>
      </aside>
    </div>
  );
}
