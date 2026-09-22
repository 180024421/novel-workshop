import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { confirmAction, confirmOverwrite, isAbortError } from "../../lib/confirm";
import { loadCharactersMarkdown } from "../../lib/characters";
import { chatCompletion, humanizeLlmError, type ChatMessage } from "../../lib/gateway";
import { checkLicense } from "../../lib/license";
import {
  agentSystemPrompt,
  generateFromChatPrompt,
  generateSystemPrompt,
  modeGenerateButtonLabel,
  selectionEditSystemAddon,
} from "../../lib/prompts";
import { countTextWords } from "../../lib/projectProgress";
import { addUsage } from "../../lib/usageLedger";
import { estimateCostCny, loadPrices, pickPrice, type PriceRow } from "../../lib/costEstimate";
import { runWritePipeline } from "../../lib/writePipeline";
import { resolveChapterTargetWords } from "../../lib/writePipelineUtils";
import {
  clearAgentThread,
  type AgentMsg,
  type StudioMode,
} from "../../lib/agentChatStore";
import type { ProviderConfig } from "../../lib/providerPresets";
import type { AppSettings, OpenedProject } from "../../types";
import type { VolumeEntry } from "../../lib/volumes";
import {
  appendChapterListLine,
  ensureVolumeBeatsFile,
  loadChapterBeatsText,
  upsertChapterBeats,
  volumeBeatsPath,
} from "../../lib/volumes";
import {
  EMPTY_QUEUE_STATE,
  QuotaBlockedError,
  runQueue,
  transition,
  type GateDecision,
  type QueueEvent,
} from "../../components/workbench/queueLogic";
import { notifyChaptersDirty } from "../../components/workbench/chapterOps";
import { buildPreflight } from "../../components/workbench/preflight";
import type { ChapterQueueState, MaterialKey, MaterialLamp, QueueAction } from "../../components/workbench/types";
import { NEXT_STEP, modeLabel, stripFences, type EditScope } from "./studioShared";

type DocApi = {
  doc: string;
  setDoc: (v: string | ((prev: string) => string)) => void;
  seed: string;
  bible: string;
  outline: string;
  setOutline: (v: string) => void;
  style: string;
  chapterBeats: string;
  setChapterBeats: (v: string) => void;
  messages: AgentMsg[];
  setMessages: (v: AgentMsg[] | ((prev: AgentMsg[]) => AgentMsg[])) => void;
  setHint: (h: string) => void;
  setErr: (e: string) => void;
  refreshVolumes: () => Promise<VolumeEntry[]>;
  scopeKey: string;
};

type Args = {
  mode: StudioMode;
  project: OpenedProject | null;
  join: (...parts: string[]) => Promise<string>;
  settings: AppSettings;
  providers: ProviderConfig[];
  llmReady: boolean;
  chapterId: string;
  chapterTitle: string;
  volumeId: string;
  currentVolume: VolumeEntry | null;
  chaptersPerVolume: number;
  chapterTargetWords: number;
  setChapterTargetWords: (n: number) => void;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  docApi: DocApi;
};

/** Agent 对话、根据对话生成、选区改写 */
export function useStudioGenerate({
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
  docApi,
}: Args) {
  const nav = useNavigate();
  const {
    doc,
    setDoc,
    seed,
    bible,
    outline,
    setOutline,
    style,
    chapterBeats,
    setChapterBeats,
    messages,
    setMessages,
    setHint,
    setErr,
    refreshVolumes,
    scopeKey,
  } = docApi;

  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [input, setInput] = useState("");
  const [showNextStep, setShowNextStep] = useState(false);
  const [editScope, setEditScope] = useState<EditScope | null>(null);
  const [liveSel, setLiveSel] = useState<{ start: number; end: number; text: string } | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);
  const writeChapterRef = useRef<(() => Promise<void>) | null>(null);
  const generateFromChatRef = useRef<
    ((replace?: boolean, beatsPhase?: "list" | "full") => Promise<void>) | null
  >(null);
  const saveNowRef = useRef<(() => Promise<void>) | null>(null);

  const license = useMemo(() => checkLicense(settings), [settings]);
  const [genBlocked, setGenBlocked] = useState<{
    maintenance: boolean;
    forceUpdate: boolean;
    reason: string;
  }>({ maintenance: false, forceUpdate: false, reason: "" });

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

  async function applyToEditor(text: string, replace: boolean) {
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
    if (replace && doc.trim() && !(await confirmOverwrite("中间编辑器内容"))) return;
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
    if (replace && doc.trim() && !(await confirmOverwrite(`${modeLabel(mode)}草稿`))) return;
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
          costCny: estimateCostCny(
            Math.min(transcript.length + context.length, 12000),
            w,
            price.cnyPer1k
          ),
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

  /* ============================================================
   * Flow C：自动续章队列（runQueue 驱动 + 同步状态镜像）
   * ============================================================ */
  const [queue, setQueue] = useState<ChapterQueueState>(EMPTY_QUEUE_STATE);
  // 同步镜像：emit 与 gate 在同一 microtask 内竞态，不能依赖 setState 提交时机
  const queueRef = useRef<ChapterQueueState>(EMPTY_QUEUE_STATE);
  const gateResolverRef = useRef<((d: GateDecision) => void) | null>(null);
  const queueAbortRef = useRef<AbortController | null>(null);
  // 异步循环里读取的当前值镜像（避免闭包捕获旧 chapterId 等）
  const chapterIdRef = useRef(chapterId);
  chapterIdRef.current = chapterId;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const providersRef = useRef(providers);
  providersRef.current = providers;

  function queueEvent(ev: QueueEvent) {
    const next = transition(queueRef.current, ev);
    queueRef.current = next;
    setQueue(next);
  }

  function resolveGate(decision: GateDecision) {
    const r = gateResolverRef.current;
    gateResolverRef.current = null;
    r?.(decision);
  }

  /**
   * 挂机语义：正常连写与单次失败不阻塞（自动 continue / skip），
   * 只有连续失败自动暂停 / 用户手动暂停 / 额度阻断时才等待人工介入。
   */
  function queueGate(
    phase: "before-chapter" | "after-failure",
    chapter: number
  ): Promise<GateDecision> {
    const s = queueRef.current;
    const manualHold = s.pausedForReview || s.quotaBlocked;
    if (phase === "before-chapter") {
      if (s.running && !manualHold) return Promise.resolve("continue");
      if (manualHold) {
        return new Promise((res) => {
          gateResolverRef.current = res;
        });
      }
      return Promise.resolve("stop");
    }
    // after-failure：非暂停态 → 自动跳过本章，保住整夜挂机
    if (!s.running || manualHold) {
      return new Promise((res) => {
        gateResolverRef.current = res;
      });
    }
    void chapter;
    return Promise.resolve("skip");
  }

  async function queueWriteChapter(
    chapter: number,
    signal: AbortSignal
  ): Promise<{ words: number }> {
    if (!project || !window.moshu) throw new Error("桌面文件桥接不可用");
    if (!license.ok) throw new QuotaBlockedError(license.reason || "授权失效，队列已停在额度线前");
    const cid = `第${chapter}章`;
    const beats = await loadChapterBeatsText({
      root: project.root,
      join,
      chapterId: cid,
    });
    if (!beats.text.trim()) {
      throw new Error(`「${cid}」还没有细纲，先去细纲页补章`);
    }
    let title = "";
    const vol = (await refreshVolumes()).find((v) =>
      v.chapters.some((c) => c.id === cid)
    );
    title = vol?.chapters.find((c) => c.id === cid)?.title || `第${chapter}章`;
    // 队列正好写到当前打开章：先清空编辑器，避免上一章残稿误导流水线
    if (modeRef.current === "chapter" && cid === chapterIdRef.current) setDoc("");
    const result = await runWritePipeline({
      root: project.root,
      join,
      chapterId: cid,
      chapterTitle: title,
      settings: settingsRef.current,
      providers: providersRef.current,
      targetWords: settingsRef.current.defaultChapterWords ?? 2500,
      signal,
      persist: true,
      onProgress: (p) => {
        setHint(`队列 · ${cid}：${p.label}`);
        if (p.bodySoFar != null && cid === chapterIdRef.current && modeRef.current === "chapter") {
          setDoc(p.bodySoFar);
        }
      },
    });
    try {
      const priceRows = await loadPrices(join);
      const enabled = providersRef.current.find((p) => p.enabled && p.apiKey.trim());
      const price = pickPrice(priceRows, enabled?.id);
      await addUsage({
        words: result.words,
        costCny: estimateCostCny(8000, result.body.length, price.cnyPer1k),
      });
    } catch {
      /* ignore */
    }
    notifyChaptersDirty();
    return { words: result.words };
  }

  function startQueue(startChapter: number, targetChapter: number) {
    if (!project || !window.moshu) return;
    if (genBlocked.maintenance || genBlocked.forceUpdate) {
      setErr(genBlocked.reason || "当前不可生成");
      return;
    }
    if (!license.ok) {
      setErr(license.reason || "试用已到期，请到设置填写授权码");
      return;
    }
    if (!llmReady) {
      nav("/setup");
      return;
    }
    const ac = new AbortController();
    queueAbortRef.current = ac;
    queueEvent({ type: "start", targetChapter, startChapter });
    void runQueue(startChapter, targetChapter, {
      writeChapter: queueWriteChapter,
      emit: queueEvent,
      gate: queueGate,
      signal: ac.signal,
    }).catch((e) => {
      queueEvent({
        type: "chapter-failed",
        chapter: queueRef.current.currentChapter ?? startChapter,
        reason: e instanceof Error ? e.message : String(e),
      });
    });
  }

  function queueAction(a: QueueAction) {
    if (a.type === "pause") {
      // 暂停边界语义：中断在途章（半章留在中间态不落盘），当前章不算失败
      queueAbortRef.current?.abort();
      queueAbortRef.current = null;
    }
    queueEvent(a);
    if (a.type === "retry") resolveGate("retry");
    else if (a.type === "skip") resolveGate("skip");
    else if (a.type === "resume") resolveGate("continue");
    else if (a.type === "stop") {
      resolveGate("stop");
      queueAbortRef.current?.abort();
      queueAbortRef.current = null;
    }
  }

  function resetQueue() {
    queueRef.current = EMPTY_QUEUE_STATE;
    setQueue(EMPTY_QUEUE_STATE);
  }

  /* ============================================================
   * Flow A：缺料就地补（内联生成 设定/总纲/本章细纲）
   * ============================================================ */
  const [repairTarget, setRepairTarget] = useState<MaterialLamp | null>(null);
  const [repairing, setRepairing] = useState<MaterialKey | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairDoneHint, setRepairDoneHint] = useState<string | null>(null);

  function dismissRepair() {
    setRepairTarget(null);
    setRepairError(null);
    setRepairDoneHint(null);
  }

  async function repairChatCompletion(system: string, user: string, signal?: AbortSignal) {
    const out = await chatCompletion(
      settings,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        providers,
        model: settings.routeOutline || settings.routeChapter || "小说",
        stream: false,
        signal,
      }
    );
    return stripFences(out);
  }

  async function doRepair(lamp: MaterialLamp) {
    if (!project || !window.moshu) return;
    if (!llmReady) {
      nav("/setup");
      return;
    }
    const action = lamp.repairAction;
    if (action === "gen-setup" && !seed.trim() && !bible.trim()) {
      // 设定没有可依据的原始想法 → 跳回设定页聊，比盲生成负责
      setHint("先去「设定」页聊两句原始想法，再回来一键生成");
      nav("/app/idea");
      return;
    }
    setRepairTarget(lamp);
    setRepairError(null);
    setRepairDoneHint(null);
    setRepairing(lamp.key);
    try {
      if (action === "gen-setup") {
        const text = await repairChatCompletion(
          generateSystemPrompt("idea"),
          `【任务：据原始想法生成「设定」草稿】\n原始想法：\n${seed.slice(0, 2000)}\n输出设定 Markdown（卖点/世界观规则/主要人物/风格禁忌），禁止章节列表与正文。`
        );
        if (!text.trim()) throw new Error("模型没有返回内容");
        await window.moshu.writeText(await join(project.root, "bible", "world.md"), text);
        setHint("设定已就地生成");
        setRepairDoneHint("已写入 bible/world.md");
      } else if (action === "gen-outline") {
        const text = await repairChatCompletion(
          generateSystemPrompt("outline"),
          `【任务：据设定生成全书总纲】\n设定：\n${(bible || seed).slice(0, 6000)}\n输出总纲 Markdown（卖点/梗概/世界观/主要人物/主线冲突/分卷主题），严禁第N章列表。`
        );
        if (!text.trim()) throw new Error("模型没有返回内容");
        await window.moshu.writeText(await join(project.root, "outlines", "outline.md"), text);
        setOutline(text);
        void refreshVolumes();
        setHint("总纲已就地生成");
        setRepairDoneHint(`总纲约 ${countTextWords(text)} 字，已写入 outlines/outline.md`);
      } else if (action === "gen-beats") {
        const n = Number(chapterId.match(/\d+/)?.[0] || 1);
        const text = await repairChatCompletion(
          generateSystemPrompt("beats"),
          [
            `【任务：只为「${chapterId} ${chapterTitle}」生成分章细纲】`,
            `总纲：\n${(outline || bible).slice(0, 6000)}`,
            chapterBeats.trim() ? `已有残段（可参考补全）：\n${chapterBeats.slice(0, 1500)}` : "",
            `输出一个 Markdown 块：首行「## ${chapterId} ${chapterTitle}」，下面 3～6 场（每场一句：地点-冲突-钩子）。不要写正文、不要输出其它章。`,
          ]
            .filter(Boolean)
            .join("\n\n")
        );
        if (!text.trim()) throw new Error("模型没有返回内容");
        const vol = currentVolume || (await refreshVolumes())[0];
        const volumeIdNext = vol?.id || "第1卷";
        const ensured = await ensureVolumeBeatsFile({
          root: project.root,
          join,
          volumeId: volumeIdNext,
        });
        let md = ensured.text;
        if (!new RegExp(`第\\s*${n}\\s*章`).test(md)) {
          md = appendChapterListLine(md, `第${n}章`, chapterTitle || `第${n}章`);
        }
        md = upsertChapterBeats(md, `第${n}章`, text);
        await window.moshu.writeText(
          await join(project.root, "beats", volumeBeatsPath(volumeIdNext)),
          md
        );
        setChapterBeats(text);
        void refreshVolumes();
        notifyChaptersDirty();
        setHint("本章细纲已就地补齐");
        setRepairDoneHint(`${chapterId} 细纲已写入「${volumeIdNext}」，可直接生成正文`);
      }
    } catch (e) {
      setRepairError(e instanceof Error ? e.message : String(e));
    } finally {
      setRepairing(null);
    }
  }

  /* ============================================================
   * Flow D：生成前预检（额度充足 → 主按钮零弹窗）
   * ============================================================ */
  const [prices, setPrices] = useState<PriceRow | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const rows = await loadPrices(join);
        const enabled = providers.find((p) => p.enabled && p.apiKey.trim());
        setPrices(pickPrice(rows, enabled?.id));
      } catch {
        /* ignore */
      }
    })();
  }, [join, providers]);

  // 无「每日成本预算」概念：授权有效即不限额（Infinity → 预检恒 ok）
  const estimatedCostCny = useMemo(() => {
    if (!prices) return 0;
    return estimateCostCny(
      Math.min(messages.length * 400 + 4000, 16000),
      mode === "chapter" ? chapterTargetWords * 1.6 : 4000,
      prices.cnyPer1k
    );
  }, [prices, messages.length, mode, chapterTargetWords]);
  const remainingQuotaCny = license.ok ? Number.POSITIVE_INFINITY : 0;
  const preflight = useMemo(
    () =>
      buildPreflight({
        estimatedCostCny,
        remainingQuotaCny,
        licenseOk: license.ok,
      }),
    [estimatedCostCny, remainingQuotaCny, license.ok]
  );

  async function clearChat() {
    if (messages.length && !(await confirmAction("确定清空当前页的 Agent 对话？"))) return;
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

  useEffect(() => {
    const onHotkey = (ev: Event) => {
      const action = (ev as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "save") {
        void saveNowRef.current?.();
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

  return {
    busy,
    setBusy,
    agentBusy,
    input,
    setInput,
    showNextStep,
    setShowNextStep,
    editScope,
    liveSel,
    abortRef,
    writeChapterRef,
    generateFromChatRef,
    saveNowRef,
    license,
    generateDisabled,
    cancel,
    syncLiveSelection,
    lockSelectionFromEditor,
    lockWholeDocument,
    clearEditScope,
    applyToEditor,
    sendChat,
    generateFromChat,
    clearChat,
    // Flow C 队列
    queue,
    startQueue,
    queueAction,
    resetQueue,
    // Flow A 就地补料
    repairTarget,
    repairing,
    repairError,
    repairDoneHint,
    doRepair,
    dismissRepair,
    // Flow D 预检
    preflight,
    estimatedCostCny,
    remainingQuotaCny,
  };
}
