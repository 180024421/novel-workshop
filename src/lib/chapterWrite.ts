import { backupChapter } from "./backup";
import { loadCharactersMarkdown } from "./characters";
import { chatCompletion } from "./gateway";
import { extractAndSaveHooks, formatOpenHooksForPrompt, loadHooksLedger } from "./hooksLedger";
import { formatKbForPrompt, inferKbTags } from "./kb";
import { retrieveForWriting } from "./kbRetrieve";
import { chapterPrompt, SYSTEM_WRITER } from "./prompts";
import { withRetry, sleep } from "./retry";
import { countTextWords } from "./projectProgress";
import type { ProviderConfig } from "./providerPresets";
import type { AppSettings, KbChunk } from "../types";
import { loadChapterBeatsText } from "./volumes";
import { pickPrevChapterFile } from "./chapterNav";
import {
  createBatchSession,
  loadBatchSession,
  markBatchDone,
  markBatchFailed,
  markBatchSkipped,
  saveBatchSession,
  type BatchSession,
} from "./batchSession";
import {
  runWritePipeline,
  type WritePipelinePhase,
  type WritePipelineProgress,
  type WritePipelineResult,
} from "./writePipeline";
import { loadEntities, matchEntities, formatEntitiesForPrompt } from "./entities";
import {
  formatRecentSummariesForPrompt,
  loadSummaries,
  parseSummaryText,
  summarizePrompt,
  upsertChapterSummary,
} from "./summaries";

export type WritePreset = "quality" | "fast";

export type BatchJob = {
  from: number;
  to: number;
  skipExisting: boolean;
  targetWords: number;
  delayMs: number;
};

export type BatchProgress = {
  current: string;
  done: number;
  total: number;
  log: string[];
  /** 实际写入字数合计 */
  wordsWritten: number;
  session?: BatchSession | null;
};

export type BatchRunMode = "new" | "continue" | "retryFailed";

export function resolveWritePreset(
  settings: AppSettings,
  override?: WritePreset
): WritePreset {
  if (override === "fast" || override === "quality") return override;
  return settings.writePreset === "fast" ? "fast" : "quality";
}

export async function writeOneChapter(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  chapterId: string;
  chapterTitle: string;
  settings: AppSettings;
  providers: ProviderConfig[];
  targetWords?: number;
  signal?: AbortSignal;
  onDelta?: (t: string) => void;
  onProgress?: (p: WritePipelineProgress) => void;
  onResult?: (result: WritePipelineResult) => void;
  extractHooks?: boolean;
  /** 本次任务临时覆盖设置中的预设（不写回） */
  writePreset?: WritePreset;
  skipBeatsCheck?: boolean;
  skipPolish?: boolean;
  getSkipPolish?: () => boolean;
  resumeFrom?: WritePipelinePhase;
  resumeBody?: string;
}): Promise<string> {
  const preset = resolveWritePreset(opts.settings, opts.writePreset);
  const forcePipeline = Boolean(opts.resumeFrom);
  const usePipeline =
    forcePipeline ||
    (preset !== "fast" && opts.settings.writePipelineEnabled !== false);

  if (usePipeline) {
    const result = await runWritePipeline({
      root: opts.root,
      join: opts.join,
      chapterId: opts.chapterId,
      chapterTitle: opts.chapterTitle,
      settings: opts.settings,
      providers: opts.providers,
      targetWords: opts.targetWords ?? opts.settings.defaultChapterWords ?? 2500,
      signal: opts.signal,
      onProgress: opts.onProgress,
      persist: true,
      extractHooks: opts.extractHooks,
      skipBeatsCheck: opts.skipBeatsCheck,
      skipPolish: opts.skipPolish,
      getSkipPolish: opts.getSkipPolish,
      resumeFrom: opts.resumeFrom,
      resumeBody: opts.resumeBody,
    });
    opts.onResult?.(result);
    return result.body;
  }

  const w = window.moshu!;
  const loaded = await loadChapterBeatsText({
    root: opts.root,
    join: opts.join,
    chapterId: opts.chapterId,
  });
  const beats = loaded.text;
  if (!beats.trim()) throw new Error(`${opts.chapterId} 没有细纲（请先在「细纲」页按卷生成）`);

  const notes = await w.readText(
    await opts.join(opts.root, "ideas", `chapter-notes-${opts.chapterId}.md`)
  );
  const bible = await w.readText(await opts.join(opts.root, "bible", "world.md"));
  const style = await w.readText(await opts.join(opts.root, "prompts", "style.md"));
  const characters = await loadCharactersMarkdown(opts.root, opts.join);
  const ledger = await loadHooksLedger(opts.root, opts.join);
  const hooksBlock = formatOpenHooksForPrompt(ledger, 12, opts.chapterId);

  const chaptersFiles = await w.listDir(await opts.join(opts.root, "chapters"));
  let prevTail = "";
  const prevFile = pickPrevChapterFile(chaptersFiles, opts.chapterId);
  if (prevFile) {
    prevTail = await w.readText(prevFile.path);
  }

  // backup existing chapter if any
  const existingHit = chaptersFiles.find(
    (f) => f.name === `${opts.chapterId}.md` || f.name.startsWith(`${opts.chapterId}_`)
  );
  if (existingHit) {
    const oldBody = await w.readText(existingHit.path);
    if (oldBody.trim()) {
      await backupChapter({
        root: opts.root,
        join: opts.join,
        chapterId: opts.chapterId,
        body: oldBody,
        note: "批量/重写前备份",
      });
    }
  }

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
  const beatsWithNotes = [beats, notes.trim() ? `## 作者本章补充\n${notes}` : "", hooksBlock]
    .filter(Boolean)
    .join("\n\n");
  const bibleExtra = [bible, entityBlock, summaryBlock].filter(Boolean).join("\n\n");

  const text = await withRetry(
    () =>
      chatCompletion(
        opts.settings,
        [
          { role: "system", content: SYSTEM_WRITER },
          {
            role: "user",
            content: chapterPrompt({
              beats: beatsWithNotes,
              bible: bibleExtra,
              characters,
              style,
              prevTail,
              kb,
              targetWords: opts.targetWords ?? opts.settings.defaultChapterWords ?? 2500,
              openHooks: hooksBlock,
            }),
          },
        ],
        {
          providers: opts.providers,
          model: opts.settings.routeChapter || "小说",
          maxTokens: 12000,
          onDelta: opts.onDelta,
          signal: opts.signal,
        }
      ),
    { retries: 2, delayMs: 1500, signal: opts.signal }
  );

  const fileName = `${opts.chapterId}_${opts.chapterTitle || "未命名"}.md`;
  await w.writeText(await opts.join(opts.root, "chapters", fileName), text);

  if (opts.extractHooks !== false) {
    try {
      await extractAndSaveHooks({
        root: opts.root,
        join: opts.join,
        chapterId: opts.chapterId,
        body: text,
        settings: opts.settings,
        providers: opts.providers,
        signal: opts.signal,
      });
    } catch {
      /* 钩子抽取失败不挡正文 */
    }
  }
  if (opts.settings.autoSummarizeChapter !== false) {
    try {
      const raw = await chatCompletion(
        opts.settings,
        [
          { role: "system", content: SYSTEM_WRITER },
          {
            role: "user",
            content: summarizePrompt(opts.chapterId, opts.chapterTitle, text),
          },
        ],
        {
          providers: opts.providers,
          model: opts.settings.routeCheck || "复杂",
          maxTokens: 800,
          signal: opts.signal,
        }
      );
      const summary = parseSummaryText(raw);
      if (summary) {
        await upsertChapterSummary({
          root: opts.root,
          join: opts.join,
          chapterId: opts.chapterId,
          title: opts.chapterTitle,
          summary,
          words: countTextWords(text),
        });
      }
    } catch {
      /* ignore */
    }
  }
  return text;
}

export async function runBatchWrite(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  chapters: { id: string; title: string }[];
  job: BatchJob;
  settings: AppSettings;
  providers: ProviderConfig[];
  signal?: AbortSignal;
  onProgress?: (p: BatchProgress) => void;
  writePreset?: WritePreset;
  /** new=新建会话；continue=续跑 pending；retryFailed=只重试失败 */
  mode?: BatchRunMode;
  /** 传入已有会话（continue / retryFailed）；new 时可省略 */
  session?: BatchSession | null;
}): Promise<BatchProgress> {
  const mode = opts.mode ?? "new";
  const preset = resolveWritePreset(opts.settings, opts.writePreset);
  const byId = new Map(opts.chapters.map((c) => [c.id, c]));

  let session =
    opts.session ??
    (mode === "new" ? null : await loadBatchSession(opts.root, opts.join));

  let queue: { id: string; title: string }[];

  if (mode === "continue" && session) {
    queue = session.pending
      .map((id) => byId.get(id) || { id, title: "未命名" })
      .filter(Boolean);
  } else if (mode === "retryFailed" && session) {
    queue = session.failed.map((f) => byId.get(f.chapterId) || { id: f.chapterId, title: "未命名" });
    session = {
      ...session,
      pending: [...session.pending, ...session.failed.map((f) => f.chapterId)],
      failed: [],
      updatedAt: new Date().toISOString(),
    };
  } else {
    const slice = opts.chapters.filter((c) => {
      const n = Number(c.id.match(/\d+/)?.[0] || 0);
      return n >= opts.job.from && n <= opts.job.to;
    });
    queue = slice;
    session = createBatchSession({
      from: opts.job.from,
      to: opts.job.to,
      preset,
      skipExisting: opts.job.skipExisting,
      targetWords: opts.job.targetWords,
      delayMs: opts.job.delayMs,
      chapterIds: slice.map((c) => c.id),
    });
  }

  if (session) {
    await saveBatchSession(opts.root, opts.join, session);
  }

  const progress: BatchProgress = {
    current: "",
    done: session?.done.length ?? 0,
    total:
      (session?.done.length ?? 0) +
        (session?.failed.length ?? 0) +
        (session?.pending.length ?? 0) || queue.length,
    log: [],
    wordsWritten: 0,
    session,
  };
  opts.onProgress?.({ ...progress, log: [...progress.log] });

  for (let i = 0; i < queue.length; i++) {
    if (opts.signal?.aborted) {
      progress.log.push("已停止");
      break;
    }
    const ch = queue[i];
    progress.current = `${ch.id} ${ch.title}`;
    opts.onProgress?.({ ...progress, log: [...progress.log], session });

    const skipExisting = session?.skipExisting ?? opts.job.skipExisting;
    if (skipExisting && mode !== "retryFailed") {
      const files = await window.moshu!.listDir(await opts.join(opts.root, "chapters"));
      const hit = files.find(
        (f) => f.name === `${ch.id}.md` || f.name.startsWith(`${ch.id}_`)
      );
      if (hit) {
        const body = await window.moshu!.readText(hit.path);
        if (body.trim()) {
          progress.log.push(`跳过 ${ch.id}`);
          progress.done++;
          if (session) {
            session = markBatchSkipped(session, ch.id);
            await saveBatchSession(opts.root, opts.join, session);
            progress.session = session;
          }
          opts.onProgress?.({ ...progress, log: [...progress.log], session });
          continue;
        }
      }
    }

    try {
      const text = await writeOneChapter({
        root: opts.root,
        join: opts.join,
        chapterId: ch.id,
        chapterTitle: ch.title,
        settings: opts.settings,
        providers: opts.providers,
        targetWords: session?.targetWords ?? opts.job.targetWords,
        signal: opts.signal,
        writePreset: session?.preset ?? preset,
      });
      const w = countTextWords(text);
      progress.wordsWritten += w;
      progress.log.push(`完成 ${ch.id}（${w} 字）`);
      progress.done++;
      if (session) {
        session = markBatchDone(session, ch.id);
        await saveBatchSession(opts.root, opts.join, session);
        progress.session = session;
      }
      opts.onProgress?.({ ...progress, log: [...progress.log], session });
      const delay = session?.delayMs ?? opts.job.delayMs;
      if (delay > 0 && i < queue.length - 1) {
        await sleep(delay, opts.signal);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      progress.log.push(`失败 ${ch.id}: ${msg}`);
      if (session && !/已取消/.test(msg)) {
        session = markBatchFailed(session, ch.id, msg);
        await saveBatchSession(opts.root, opts.join, session);
        progress.session = session;
      }
      opts.onProgress?.({ ...progress, log: [...progress.log], session });
      if (/已取消/.test(msg)) break;
    }
  }
  progress.session = session;
  return progress;
}
