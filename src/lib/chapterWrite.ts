import { backupChapter } from "./backup";
import { loadCharactersMarkdown } from "./characters";
import { chatCompletion } from "./gateway";
import { extractAndSaveHooks, formatOpenHooksForPrompt, loadHooksLedger } from "./hooksLedger";
import { formatKbForPrompt, inferKbTags, retrieveChunks } from "./kb";
import { chapterPrompt, SYSTEM_WRITER } from "./prompts";
import { withRetry, sleep } from "./retry";
import { countTextWords } from "./projectProgress";
import type { ProviderConfig } from "./providerPresets";
import type { AppSettings, KbChunk } from "../types";
import { loadChapterBeatsText } from "./volumes";
import { pickPrevChapterFile } from "./chapterNav";
import {
  runWritePipeline,
  type WritePipelineProgress,
  type WritePipelineResult,
} from "./writePipeline";

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
};

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
}): Promise<string> {
  if (opts.settings.writePipelineEnabled !== false) {
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
  const hooksBlock = formatOpenHooksForPrompt(ledger);

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
  const kb = formatKbForPrompt(
    retrieveChunks(
      kbIndex.chunks || [],
      `${opts.chapterTitle} ${beats.slice(0, 200)}`,
      5,
      tags
    )
  );
  const beatsWithNotes = [beats, notes.trim() ? `## 作者本章补充\n${notes}` : "", hooksBlock]
    .filter(Boolean)
    .join("\n\n");

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
              bible,
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
}): Promise<BatchProgress> {
  const slice = opts.chapters.filter((c) => {
    const n = Number(c.id.match(/\d+/)?.[0] || 0);
    return n >= opts.job.from && n <= opts.job.to;
  });
  const progress: BatchProgress = {
    current: "",
    done: 0,
    total: slice.length,
    log: [],
    wordsWritten: 0,
  };
  for (let i = 0; i < slice.length; i++) {
    if (opts.signal?.aborted) {
      progress.log.push("已停止");
      break;
    }
    const ch = slice[i];
    progress.current = `${ch.id} ${ch.title}`;
    opts.onProgress?.({ ...progress });

    if (opts.job.skipExisting) {
      const files = await window.moshu!.listDir(await opts.join(opts.root, "chapters"));
      const hit = files.find(
        (f) => f.name === `${ch.id}.md` || f.name.startsWith(`${ch.id}_`)
      );
      if (hit) {
        const body = await window.moshu!.readText(hit.path);
        if (body.trim()) {
          progress.log.push(`跳过 ${ch.id}`);
          progress.done++;
          opts.onProgress?.({ ...progress });
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
        targetWords: opts.job.targetWords,
        signal: opts.signal,
      });
      const w = countTextWords(text);
      progress.wordsWritten += w;
      progress.log.push(`完成 ${ch.id}（${w} 字）`);
      progress.done++;
      opts.onProgress?.({ ...progress });
      if (opts.job.delayMs > 0 && i < slice.length - 1) {
        await sleep(opts.job.delayMs, opts.signal);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      progress.log.push(`失败 ${ch.id}: ${msg}`);
      opts.onProgress?.({ ...progress });
      if (/已取消/.test(msg)) break;
    }
  }
  return progress;
}
