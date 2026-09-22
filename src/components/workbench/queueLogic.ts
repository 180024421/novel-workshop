/**
 * ================================================
 * FLOW: Auto Chapter-Continuation Queue（自动续章队列）
 * 纯逻辑层：队列 reducer（transition）+ 驱动循环（runQueue）
 * ------------------------------------------------
 * 消费方：QueueLaunchBar（Screen 1）、QueueProgressChip / QueuePanel（Screen 2/3/4）
 * 设计：reducer 全纯函数可测；runQueue 只依赖注入的 writeChapter/gate，
 *      Phase C 集成时 writeChapter = runWritePipeline 薄包装，gate = UI 按钮闸门。
 * ================================================
 */
import type { ChapterQueueState, QueueAction } from "./types";

/** reducer 事件 = 用户动作 + 驱动循环内部事件 */
export type QueueEvent =
  | QueueAction
  | { type: "chapter-start"; chapter: number }
  | { type: "chapter-done"; chapter: number; words: number }
  | { type: "chapter-failed"; chapter: number; reason: string }
  | { type: "quota-block"; reason: string }
  | { type: "queue-finished" };

export const EMPTY_QUEUE_STATE: ChapterQueueState = {
  running: false,
  targetChapter: 0,
  startChapter: 0,
  currentChapter: null,
  completed: [],
  failures: [],
  pausedForReview: false,
  consecutiveFailures: 0,
  skipped: [],
  quotaBlocked: false,
  finished: false,
};

/** 连续失败 N 次自动暂停等待人工介入（骨架承诺值） */
export const AUTO_PAUSE_AFTER_FAILURES = 2;

function totalChapters(s: ChapterQueueState): number {
  return Math.max(0, s.targetChapter - s.startChapter + 1);
}

export function queueProgress(s: ChapterQueueState): {
  done: number;
  total: number;
  percent: number;
} {
  const total = totalChapters(s);
  const done = s.completed.length + s.skipped.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** 顶栏/侧栏 Chip 文案；队列完全静默时返回 null（不渲染） */
export function queueProgressLabel(s: ChapterQueueState): string | null {
  if (s.running) {
    const { done, total } = queueProgress(s);
    return `${done}/${total} 生成中${s.currentChapter ? ` · 第${s.currentChapter}章` : ""}`;
  }
  if (s.quotaBlocked) return "已停在额度线前";
  if (s.pausedForReview) return "队列暂停 · 等待介入";
  if (s.finished && (s.completed.length || s.failures.length)) {
    const { done, total } = queueProgress(s);
    return s.failures.length ? `${done}/${total} 完成 · 有失败` : `${done}/${total} 全部完成`;
  }
  return null;
}

/** 是否还要展示队列面板（LaunchBar 让位给运行态） */
export function isQueueVisible(s: ChapterQueueState): boolean {
  return s.running || s.pausedForReview || s.quotaBlocked || s.finished;
}

/** 队列态桥接事件（useStudioGenerate 派发 → AppLayout 监听传 ChapterSidebar.stateOverrides） */
export const QUEUE_STATE_EVENT = "moshu:queue-state";

/**
 * F5：把队列运行态映射成侧栏角标覆盖。
 * 当前章 = generating；失败未处理 = failed；
 * 起点..目标里尚未落账（完成/跳过/失败/进行中）的章 = queued。
 * 队列静默时返回 {}。
 */
export function queueBadgeOverrides(
  s: ChapterQueueState
): Record<string, "generating" | "queued" | "failed"> {
  const out: Record<string, "generating" | "queued" | "failed"> = {};
  const done = new Set<number>([
    ...s.completed.map((c) => c.chapter),
    ...s.skipped,
  ]);
  if (s.currentChapter != null) out[`第${s.currentChapter}章`] = "generating";
  for (const f of s.failures) out[`第${f.chapter}章`] = "failed";
  if (s.running || s.pausedForReview || s.quotaBlocked) {
    for (let n = s.startChapter; n <= s.targetChapter; n++) {
      const key = `第${n}章`;
      if (!done.has(n) && !(key in out)) out[key] = "queued";
    }
  }
  return out;
}

export function transition(s: ChapterQueueState, ev: QueueEvent): ChapterQueueState {
  switch (ev.type) {
    case "start":
      return {
        ...EMPTY_QUEUE_STATE,
        running: true,
        targetChapter: ev.targetChapter,
        startChapter: ev.startChapter,
      };
    case "chapter-start":
      return { ...s, running: true, currentChapter: ev.chapter };
    case "chapter-done": {
      const completed = [...s.completed, { chapter: ev.chapter, words: ev.words }];
      const targetReached = ev.chapter >= s.targetChapter;
      return {
        ...s,
        completed,
        currentChapter: null,
        consecutiveFailures: 0,
        running: !targetReached,
        finished: targetReached,
      };
    }
    case "chapter-failed": {
      const consecutiveFailures = s.consecutiveFailures + 1;
      const autoPause = consecutiveFailures >= AUTO_PAUSE_AFTER_FAILURES;
      return {
        ...s,
        failures: [...s.failures.filter((f) => f.chapter !== ev.chapter), { chapter: ev.chapter, reason: ev.reason }],
        currentChapter: null,
        consecutiveFailures,
        pausedForReview: autoPause,
        running: !autoPause,
      };
    }
    case "retry":
      return {
        ...s,
        failures: s.failures.filter((f) => f.chapter !== ev.chapter),
        pausedForReview: false,
        quotaBlocked: false,
        consecutiveFailures: 0,
        running: true,
      };
    case "skip":
      return {
        ...s,
        failures: s.failures.filter((f) => f.chapter !== ev.chapter),
        skipped: s.skipped.includes(ev.chapter) ? s.skipped : [...s.skipped, ev.chapter],
        pausedForReview: false,
        quotaBlocked: false,
        consecutiveFailures: 0,
        running: true,
      };
    case "pause":
      return { ...s, running: false, currentChapter: null };
    case "resume":
      return { ...s, running: true, pausedForReview: false, quotaBlocked: false, consecutiveFailures: 0 };
    case "quota-block":
      // 停在当章之前：不标记失败、不烧穿额度
      return { ...s, running: false, currentChapter: null, quotaBlocked: true };
    case "stop":
      return { ...s, running: false, currentChapter: null, pausedForReview: false, finished: true };
    case "queue-finished":
      return { ...s, running: false, currentChapter: null, finished: true, pausedForReview: false };
  }
}

/* ---------- 驱动循环 ---------- */

export type GateDecision = "continue" | "retry" | "skip" | "stop";

/** writeChapter 抛这个错 → 队列「停在当章之前」，不记失败不烧穿（Flow C 终态 ❌） */
export class QuotaBlockedError extends Error {}

export type QueueDeps = {
  /** 写一章正文；Phase C = runWritePipeline 包装。抛错视为该章失败 */
  writeChapter: (chapter: number, signal: AbortSignal) => Promise<{ words: number }>;
  emit: (ev: QueueEvent) => void;
  signal: AbortSignal;
  /**
   * UI 闸门：before-chapter 只在暂停/介入后调用（正常连写立即返回 continue）。
   * after-failure 等待用户点「重试 / 跳过 / 停队列」。
   */
  gate: (phase: "before-chapter" | "after-failure", chapter: number) => Promise<GateDecision>;
};

/**
 * 从 startChapter 顺序写到 targetChapter。
 * 已生成章节由 writeChapter 自行落盘（persist:true），本循环中断不回收。
 */
export async function runQueue(
  startChapter: number,
  targetChapter: number,
  deps: QueueDeps
): Promise<void> {
  for (let chapter = startChapter; chapter <= targetChapter; chapter++) {
    const before = await deps.gate("before-chapter", chapter);
    if (before === "stop" || deps.signal.aborted) return;

    deps.emit({ type: "chapter-start", chapter });
    let settled = false;
    while (!settled && !deps.signal.aborted) {
      try {
        const r = await deps.writeChapter(chapter, deps.signal);
        deps.emit({ type: "chapter-done", chapter, words: r.words });
        settled = true;
      } catch (e) {
        if (deps.signal.aborted) return;
        if (e instanceof QuotaBlockedError) {
          deps.emit({ type: "quota-block", reason: e.message });
          return; // 停在当章之前：不记失败、不进下一章
        }
        const reason = e instanceof Error ? e.message : String(e);
        deps.emit({ type: "chapter-failed", chapter, reason });
        const after = await deps.gate("after-failure", chapter);
        if (after === "stop") return;
        if (after === "skip") {
          settled = true; // 本章放弃，进入下一章
          break;
        }
        // after === "retry" | "continue" → 重试同一章
        deps.emit({ type: "chapter-start", chapter });
      }
    }
    if (deps.signal.aborted) return;
  }
  deps.emit({ type: "queue-finished" });
}
