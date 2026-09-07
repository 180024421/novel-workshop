import { backupChapter } from "./backup";
import { loadCharactersMarkdown } from "./characters";
import { chatCompletion } from "./gateway";
import {
  extractAndSaveHooks,
  formatOpenHooksForPrompt,
  loadHooksLedger,
} from "./hooksLedger";
import { formatKbForPrompt, inferKbTags } from "./kb";
import { retrieveForWriting } from "./kbRetrieve";
import { pickPrevChapterFile } from "./chapterNav";
import { countTextWords } from "./projectProgress";
import { beatsCheckPrompt, SYSTEM_WRITER } from "./prompts";
import type { ProviderConfig } from "./providerPresets";
import { withRetry } from "./retry";
import { loadChapterBeatsText } from "./volumes";
import {
  beatsFixPrompt,
  briefPrompt,
  compressPrompt,
  continuePrompt,
  planPrompt,
  polishPrompt,
  scenePrompt,
} from "./writePipelinePrompts";
import {
  DEFAULT_MAX_RATIO,
  DEFAULT_MIN_RATIO,
  estimateMaxTokens,
  fallbackScenePlan,
  isWholeChapterReplacementSane,
  normalizePlanBudgets,
  parseScenePlan,
  reportHasMissingBeats,
  wordGateStatus,
} from "./writePipelineUtils";
import type { AppSettings, KbChunk } from "../types";
import { loadEntities, matchEntities, formatEntitiesForPrompt } from "./entities";
import {
  formatRecentSummariesForPrompt,
  loadSummaries,
  parseSummaryText,
  summarizePrompt,
  upsertChapterSummary,
} from "./summaries";
import { formatContextBlocksForPrompt } from "./writeContextPreview";

export type WritePipelinePhase =
  | "brief"
  | "plan"
  | "scene"
  | "wordgate"
  | "beats_check"
  | "polish"
  | "report"
  | "done"
  | "error";

export type WritePipelineProgress = {
  phase: WritePipelinePhase;
  label: string;
  sceneIndex?: number;
  sceneTotal?: number;
  wordsNow?: number;
  wordsTarget?: number;
  bodySoFar?: string;
};

export type WritePipelineResult = {
  body: string;
  words: number;
  targetWords: number;
  ratio: number;
  continueRounds: number;
  beatsReport: string;
  phaseLog: string[];
};

type PipelineSettings = AppSettings & {
  writePipelineWordGate?: boolean;
  writePipelineBeatsCheck?: boolean;
  writePipelinePolish?: boolean;
  writePipelineMinRatio?: number;
  writePipelineMaxRatio?: number;
};

function appendBody(body: string, addition: string): string {
  return [body.trimEnd(), addition.trim()].filter(Boolean).join("\n\n");
}

const PHASE_RANK: Record<WritePipelinePhase, number> = {
  brief: 0,
  plan: 1,
  scene: 2,
  wordgate: 3,
  beats_check: 4,
  polish: 5,
  report: 6,
  done: 7,
  error: -1,
};

export async function runWritePipeline(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  chapterId: string;
  chapterTitle: string;
  settings: AppSettings;
  providers: ProviderConfig[];
  targetWords: number;
  signal?: AbortSignal;
  onProgress?: (p: WritePipelineProgress) => void;
  /** false 时跳过落盘（Studio 仅写编辑器时可由调用方落盘） */
  persist?: boolean;
  extractHooks?: boolean;
  /** 跳过细纲自检（覆盖设置） */
  skipBeatsCheck?: boolean;
  /** 跳过润色（覆盖设置） */
  skipPolish?: boolean;
  /** 运行中可轮询：为 true 时跳过润色 */
  getSkipPolish?: () => boolean;
  /** 当前场写完后若返回 true，停止后续场次并保留已写 */
  getStopAfterScene?: () => boolean;
  /** 从指定阶段续跑（需配合 resumeBody） */
  resumeFrom?: WritePipelinePhase;
  resumeBody?: string;
  /** 写章显式上下文块（预览勾选组装后的文本） */
  contextBlocks?: string;
}): Promise<WritePipelineResult> {
  const w = window.moshu;
  if (!w) throw new Error("桌面文件桥接不可用");

  const settings = opts.settings as PipelineSettings;
  const targetWords = Math.max(1, Math.round(opts.targetWords));
  const minRatio = settings.writePipelineMinRatio ?? DEFAULT_MIN_RATIO;
  const maxRatio = settings.writePipelineMaxRatio ?? DEFAULT_MAX_RATIO;
  const phaseLog: string[] = [];
  const startPhase = opts.resumeFrom ?? "brief";
  const startRank = PHASE_RANK[startPhase] ?? 0;
  const runFrom = (phase: WritePipelinePhase) => (PHASE_RANK[phase] ?? 0) >= startRank;
  const skipBeatsCheck =
    opts.skipBeatsCheck === true || settings.writePipelineSkipBeatsCheck === true;
  const resolveSkipPolish = () =>
    opts.skipPolish === true ||
    settings.writePipelineSkipPolish === true ||
    Boolean(opts.getSkipPolish?.());
  let body = opts.resumeFrom && opts.resumeBody != null ? opts.resumeBody : "";
  let streamedBody = body;
  let replaceInFlight = false;
  let beatsReport = "";
  let continueRounds = 0;

  const emit = (progress: WritePipelineProgress) => {
    opts.onProgress?.(progress);
  };
  const logPhase = (phase: WritePipelinePhase, label: string) => {
    phaseLog.push(label);
    emit({
      phase,
      label,
      wordsNow: body ? countTextWords(body) : undefined,
      wordsTarget: targetWords,
      bodySoFar: body || undefined,
    });
  };
  const acceptReplacement = (step: string, oldBody: string, newBody: string) => {
    if (isWholeChapterReplacementSane(oldBody, newBody)) return newBody;
    const reason = !newBody.trim()
      ? `${step}结果为空，已保留原正文`
      : `${step}结果不足原文 80%，疑似截断，已保留原正文`;
    phaseLog.push(reason);
    return oldBody;
  };
  const call = (
    prompt: string,
    model: string,
    maxTokens: number,
    onDelta?: (delta: string, generated: string) => void
  ) =>
    withRetry(
      () => {
        let generated = "";
        return chatCompletion(
          opts.settings,
          [
            { role: "system", content: SYSTEM_WRITER },
            { role: "user", content: prompt },
          ],
          {
            providers: opts.providers,
            model,
            maxTokens,
            signal: opts.signal,
            onDelta: onDelta
              ? (delta) => {
                  generated += delta;
                  onDelta(delta, generated);
                }
              : undefined,
          }
        );
      },
      { retries: 2, delayMs: 1500, signal: opts.signal }
    );

  try {
    const loaded = await loadChapterBeatsText({
      root: opts.root,
      join: opts.join,
      chapterId: opts.chapterId,
    });
    const beats = loaded.text;
    if (!beats.trim()) {
      throw new Error(`${opts.chapterId} 没有细纲（请先在「细纲」页按卷生成）`);
    }

    const notes = await w.readText(
      await opts.join(opts.root, "ideas", `chapter-notes-${opts.chapterId}.md`)
    );
    const bible = await w.readText(await opts.join(opts.root, "bible", "world.md"));
    const style = await w.readText(await opts.join(opts.root, "prompts", "style.md"));
    const characters = await loadCharactersMarkdown(opts.root, opts.join);
    const ledger = await loadHooksLedger(opts.root, opts.join);
    const hooks = formatOpenHooksForPrompt(ledger, 12, opts.chapterId);
    const chapterFiles = await w.listDir(await opts.join(opts.root, "chapters"));
    const prevFile = pickPrevChapterFile(chapterFiles, opts.chapterId);
    const prevTail = prevFile ? await w.readText(prevFile.path) : "";
    const kbIndex = await w.readJson<{ chunks: KbChunk[] }>(
      await opts.join(opts.root, "kb", "index.json"),
      { chunks: [] }
    );
    const tags = inferKbTags(`${opts.chapterTitle}\n${beats}`);
    const query = `${opts.chapterTitle} ${beats.slice(0, 200)}`;
    const mergedKb = await retrieveForWriting({
      chunks: kbIndex.chunks || [],
      query,
      tags,
      settings: opts.settings,
      providers: opts.providers,
      root: opts.root,
      join: opts.join,
      signal: opts.signal,
    });
    const kb = formatKbForPrompt(mergedKb);
    const entities = await loadEntities(opts.root, opts.join);
    const entityBlock = formatEntitiesForPrompt(
      matchEntities(`${beats}\n${opts.chapterTitle}\n${notes}`, entities, 8)
    );
    const summaries = await loadSummaries(opts.root, opts.join);
    const summaryBlock = formatRecentSummariesForPrompt(
      summaries,
      opts.chapterId,
      opts.settings.summaryInjectCount ?? 5
    );
    const ctxBlock = formatContextBlocksForPrompt(opts.contextBlocks || "");
    const beatsWithNotes = [
      beats,
      notes.trim() ? `## 作者本章补充\n${notes}` : "",
      ctxBlock,
    ]
      .filter(Boolean)
      .join("\n\n");
    const bibleWithKb = [bible, kb, entityBlock, summaryBlock, hooks]
      .filter(Boolean)
      .join("\n\n");
    const chapterModel = opts.settings.routeChapter || "小说";
    const checkModel = opts.settings.routeCheck || "复杂";

    let brief = beatsWithNotes;
    let plan = fallbackScenePlan(beats, targetWords);

    if (runFrom("brief")) {
      logPhase("brief", "① 生成章前简报");
      try {
        brief = await call(
          briefPrompt({
            beats: beatsWithNotes,
            bible: bibleWithKb,
            characters,
            style,
            prevTail,
            hooks,
            targetWords,
          }),
          chapterModel,
          estimateMaxTokens(1200)
        );
      } catch (error) {
        if (opts.signal?.aborted) throw error;
        brief = beatsWithNotes;
        phaseLog.push("章前简报失败，已按细纲降级");
      }
    } else {
      phaseLog.push(`续跑：跳过章前简报（自 ${startPhase}）`);
    }

    if (runFrom("plan")) {
      logPhase("plan", "② 规划场次字数");
      try {
        const rawPlan = await call(
          planPrompt({ brief, beats: beatsWithNotes, targetWords }),
          chapterModel,
          estimateMaxTokens(800)
        );
        const parsed = parseScenePlan(rawPlan);
        if (parsed.length) plan = parsed;
        else phaseLog.push("场次计划解析失败，已按细纲降级");
      } catch (error) {
        if (opts.signal?.aborted) throw error;
        phaseLog.push("场次规划失败，已按细纲降级");
      }
      plan = normalizePlanBudgets(plan, targetWords);
    }

    if (runFrom("scene")) {
      let stoppedEarly = false;
      for (let i = 0; i < plan.length; i++) {
        if (opts.signal?.aborted || opts.getStopAfterScene?.()) {
          phaseLog.push(`已停止：保留已写 ${i}/${plan.length} 场`);
          stoppedEarly = true;
          break;
        }
        const scene = plan[i];
        const prefix = body;
        const label = `③ 撰写场次 ${i + 1}/${plan.length}`;
        phaseLog.push(label);
        emit({
          phase: "scene",
          label,
          sceneIndex: i + 1,
          sceneTotal: plan.length,
          wordsNow: countTextWords(body),
          wordsTarget: targetWords,
          bodySoFar: body,
        });
        try {
          const sceneText = await call(
            scenePrompt({
              brief,
              scene,
              sceneIndex: i + 1,
              sceneTotal: plan.length,
              prevSceneTail: body,
              characters,
              style,
              isFirst: i === 0,
              chapterTitle: opts.chapterTitle,
              chapterId: opts.chapterId,
            }),
            chapterModel,
            estimateMaxTokens(scene.budget),
            (_delta, generated) => {
              const bodySoFar = appendBody(prefix, generated);
              streamedBody = bodySoFar;
              emit({
                phase: "scene",
                label,
                sceneIndex: i + 1,
                sceneTotal: plan.length,
                wordsNow: countTextWords(bodySoFar),
                wordsTarget: targetWords,
                bodySoFar,
              });
            }
          );
          body = appendBody(body, sceneText);
          streamedBody = body;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (opts.signal?.aborted || /已取消|AbortError/i.test(message)) {
            // 中场取消：保留已拼接正文
            body = streamedBody || body;
            phaseLog.push(`场次 ${i + 1} 中断，已保留此前场次`);
            stoppedEarly = true;
            break;
          }
          throw error;
        }
        if (opts.getStopAfterScene?.()) {
          phaseLog.push(`用户要求停在本场后：已完成 ${i + 1}/${plan.length}`);
          stoppedEarly = true;
          break;
        }
      }
      if (stoppedEarly) {
        // 跳过后续门禁，直接落盘已写内容
        logPhase("report", "提前结束：落盘已写场次");
        if (opts.persist !== false && body.trim()) {
          const fileName = `${opts.chapterId}_${opts.chapterTitle || "未命名"}.md`;
          await w.writeText(await opts.join(opts.root, "chapters", fileName), body);
        }
        const words = countTextWords(body);
        return {
          body,
          words,
          targetWords,
          ratio: words / targetWords,
          continueRounds,
          beatsReport: "（提前停止，未跑细纲自检）",
          phaseLog,
        };
      }
    } else if (opts.resumeBody != null) {
      body = opts.resumeBody;
      streamedBody = body;
      phaseLog.push(`续跑：载入已有正文 ${countTextWords(body)} 字`);
    }

    if (runFrom("wordgate") && settings.writePipelineWordGate !== false) {
      logPhase("wordgate", "④ 检查正文长度");
      let status = wordGateStatus(countTextWords(body), targetWords, minRatio, maxRatio);
      while (status === "under" && continueRounds < 3) {
        const wordsNow = countTextWords(body);
        const gap = Math.max(0, targetWords - wordsNow);
        const prefix = body;
        continueRounds++;
        const label = `④ 补写第 ${continueRounds}/3 轮`;
        phaseLog.push(label);
        const addition = await call(
          continuePrompt({ body, wordsNow, targetWords, gap, brief }),
          chapterModel,
          estimateMaxTokens(gap),
          (_delta, generated) => {
            const bodySoFar = appendBody(prefix, generated);
            streamedBody = bodySoFar;
            emit({
              phase: "wordgate",
              label,
              wordsNow: countTextWords(bodySoFar),
              wordsTarget: targetWords,
              bodySoFar,
            });
          }
        );
        body = appendBody(body, addition);
        streamedBody = body;
        status = wordGateStatus(countTextWords(body), targetWords, minRatio, maxRatio);
      }
      if (status === "over") {
        const wordsNow = countTextWords(body);
        const label = "④ 轻度压缩超长正文";
        phaseLog.push(label);
        const oldBody = body;
        streamedBody = body;
        replaceInFlight = true;
        const newText = await call(
          compressPrompt({ body, wordsNow, targetWords }),
          chapterModel,
          estimateMaxTokens(targetWords),
          () => {
            emit({
              phase: "wordgate",
              label,
              wordsNow: countTextWords(oldBody),
              wordsTarget: targetWords,
              bodySoFar: oldBody,
            });
          }
        );
        replaceInFlight = false;
        body = acceptReplacement("压缩", oldBody, newText);
        streamedBody = body;
      }
    }

    if (
      runFrom("beats_check") &&
      settings.writePipelineBeatsCheck !== false &&
      !skipBeatsCheck
    ) {
      logPhase("beats_check", "⑤ 对照细纲自检");
      beatsReport = await call(
        beatsCheckPrompt(beatsWithNotes, body),
        checkModel,
        estimateMaxTokens(1200)
      );
      for (let fixRound = 1; fixRound <= 2 && reportHasMissingBeats(beatsReport); fixRound++) {
        const prefix = body;
        const label = `⑤ 补齐细纲缺失 ${fixRound}/2`;
        phaseLog.push(label);
        const addition = await call(
          beatsFixPrompt({
            beats: beatsWithNotes,
            body,
            checkReport: beatsReport,
          }),
          chapterModel,
          estimateMaxTokens(Math.max(600, Math.round(targetWords * 0.25))),
          (_delta, generated) => {
            const bodySoFar = appendBody(prefix, generated);
            streamedBody = bodySoFar;
            emit({
              phase: "beats_check",
              label,
              wordsNow: countTextWords(bodySoFar),
              wordsTarget: targetWords,
              bodySoFar,
            });
          }
        );
        body = appendBody(body, addition);
        streamedBody = body;
        beatsReport = await call(
          beatsCheckPrompt(beatsWithNotes, body),
          checkModel,
          estimateMaxTokens(1200)
        );
      }
    } else if (runFrom("beats_check") && skipBeatsCheck) {
      phaseLog.push("已跳过细纲自检");
    }

    if (
      runFrom("polish") &&
      settings.writePipelinePolish !== false &&
      !resolveSkipPolish()
    ) {
      logPhase("polish", "⑥ 连贯与声口润色");
      const label = "⑥ 连贯与声口润色";
      const oldBody = body;
      streamedBody = body;
      replaceInFlight = true;
      const newText = await call(
        polishPrompt({ body, prevTail, bible: bibleWithKb, characters }),
        checkModel,
        estimateMaxTokens(Math.max(targetWords, countTextWords(body))),
        () => {
          emit({
            phase: "polish",
            label,
            wordsNow: countTextWords(oldBody),
            wordsTarget: targetWords,
            bodySoFar: oldBody,
          });
        }
      );
      replaceInFlight = false;
      body = acceptReplacement("润色", oldBody, newText);
      streamedBody = body;
    } else if (runFrom("polish") && resolveSkipPolish()) {
      phaseLog.push("已跳过润色");
    }

    logPhase("report", "⑦ 生成终检报告并落盘");
    if (opts.persist !== false) {
      const existing = chapterFiles.find(
        (file) =>
          file.name === `${opts.chapterId}.md` ||
          file.name.startsWith(`${opts.chapterId}_`)
      );
      if (existing) {
        const oldBody = await w.readText(existing.path);
        if (oldBody.trim()) {
          await backupChapter({
            root: opts.root,
            join: opts.join,
            chapterId: opts.chapterId,
            body: oldBody,
            note: "流水线重写前备份",
          });
        }
      }
      const fileName = `${opts.chapterId}_${opts.chapterTitle || "未命名"}.md`;
      await w.writeText(await opts.join(opts.root, "chapters", fileName), body);
      if (opts.extractHooks !== false) {
        try {
          await withRetry(
            () =>
              extractAndSaveHooks({
                root: opts.root,
                join: opts.join,
                chapterId: opts.chapterId,
                body,
                settings: opts.settings,
                providers: opts.providers,
                signal: opts.signal,
              }),
            { retries: 2, delayMs: 1500, signal: opts.signal }
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (opts.signal?.aborted || /已取消|AbortError/i.test(message)) throw error;
          // 钩子抽取失败不阻挡正文落盘。
        }
      }
      if (opts.settings.autoSummarizeChapter !== false) {
        try {
          const raw = await call(
            summarizePrompt(opts.chapterId, opts.chapterTitle, body),
            checkModel,
            estimateMaxTokens(400)
          );
          const summary = parseSummaryText(raw);
          if (summary) {
            await upsertChapterSummary({
              root: opts.root,
              join: opts.join,
              chapterId: opts.chapterId,
              title: opts.chapterTitle,
              summary,
              words: countTextWords(body),
            });
            phaseLog.push("已更新章摘要");
          }
        } catch {
          phaseLog.push("章摘要失败（可忽略）");
        }
      }
    }

    const words = countTextWords(body);
    const ratio = words / targetWords;
    logPhase("done", `完成：${words}/${targetWords} 字（${Math.round(ratio * 100)}%）`);
    return {
      body,
      words,
      targetWords,
      ratio,
      continueRounds,
      beatsReport,
      phaseLog,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const bodySoFar = replaceInFlight ? body : streamedBody || body;
    phaseLog.push(`失败：${message}`);
    emit({
      phase: "error",
      label: message,
      wordsNow: bodySoFar ? countTextWords(bodySoFar) : 0,
      wordsTarget: targetWords,
      bodySoFar,
    });
    throw error;
  }
}
