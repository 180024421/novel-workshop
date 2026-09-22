import { describe, expect, it } from "vitest";
import {
  EMPTY_QUEUE_STATE,
  QuotaBlockedError,
  queueProgress,
  queueProgressLabel,
  runQueue,
  transition,
  type GateDecision,
  type QueueEvent,
} from "./queueLogic";
import type { ChapterQueueState } from "./types";

function start(s: Partial<ChapterQueueState> = {}): ChapterQueueState {
  const fresh = transition(EMPTY_QUEUE_STATE, {
    type: "start",
    targetChapter: 12,
    startChapter: 10,
  });
  return { ...fresh, ...s };
}

describe("transition", () => {
  it("start 重置一切并进入运行态", () => {
    const s = start();
    expect(s.running).toBe(true);
    expect(s.targetChapter).toBe(12);
    expect(s.completed).toEqual([]);
  });

  it("写到目标章自动 finished 并停机", () => {
    let s = start();
    s = transition(s, { type: "chapter-start", chapter: 12 });
    s = transition(s, { type: "chapter-done", chapter: 12, words: 3000 });
    expect(s.finished).toBe(true);
    expect(s.running).toBe(false);
    expect(queueProgress(s).done).toBe(1);
  });

  it("连续失败 2 次自动暂停等待介入；成功一次即清零", () => {
    let s = start();
    s = transition(s, { type: "chapter-failed", chapter: 10, reason: "网络" });
    expect(s.pausedForReview).toBe(false); // 第 1 败不暂停
    s = transition(s, { type: "chapter-failed", chapter: 11, reason: "超时" });
    expect(s.pausedForReview).toBe(true);
    expect(s.running).toBe(false);
    s = transition(s, { type: "retry", chapter: 11 });
    expect(s.pausedForReview).toBe(false);
    expect(s.running).toBe(true);
    expect(s.failures.map((f) => f.chapter)).toEqual([10]);
    s = transition(s, { type: "chapter-done", chapter: 11, words: 2500 });
    expect(s.consecutiveFailures).toBe(0);
  });

  it("skip 记入跳过且不再算失败", () => {
    let s = start();
    s = transition(s, { type: "chapter-failed", chapter: 10, reason: "x" });
    s = transition(s, { type: "skip", chapter: 10 });
    expect(s.skipped).toEqual([10]);
    expect(s.failures).toEqual([]);
    expect(s.running).toBe(true);
  });

  it("quota-block 停机但不记失败（停在当章之前）", () => {
    let s = start();
    s = transition(s, { type: "quota-block", reason: "额度耗尽" });
    expect(s.quotaBlocked).toBe(true);
    expect(s.running).toBe(false);
    expect(s.failures).toEqual([]);
    expect(queueProgressLabel(s)).toBe("已停在额度线前");
  });

  it("同一章重复失败只保留最新一条失败记录", () => {
    let s = start();
    s = transition(s, { type: "chapter-failed", chapter: 10, reason: "a" });
    s = transition(s, { type: "chapter-failed", chapter: 10, reason: "b" });
    expect(s.failures).toEqual([{ chapter: 10, reason: "b" }]);
    expect(s.consecutiveFailures).toBe(2);
  });
});

/* ---------- runQueue 驱动（假 writeChapter + 脚本化 gate） ---------- */

type Writer = (chapter: number) => Promise<{ words: number }>;

function harness(writeChapter: Writer, gateMap: Record<string, GateDecision> = {}) {
  const events: QueueEvent[] = [];
  const ac = new AbortController();
  const deps = {
    writeChapter: async (chapter: number, _signal: AbortSignal) => writeChapter(chapter),
    emit: (ev: QueueEvent) => events.push(ev),
    signal: ac.signal,
    gate: async (phase: "before-chapter" | "after-failure", chapter: number): Promise<GateDecision> =>
      gateMap[`${phase}:${chapter}`] ?? gateMap[phase] ?? "continue",
  };
  return { events, deps };
}

describe("runQueue", () => {
  it("happy path：10→12 顺序启动、完成、收尾事件", async () => {
    const { events, deps } = harness(async () => ({ words: 3000 }));
    await runQueue(10, 12, deps);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "chapter-start", "chapter-done",
      "chapter-start", "chapter-done",
      "chapter-start", "chapter-done",
      "queue-finished",
    ]);
    const doneChapters = events.filter((e) => e.type === "chapter-done").map((e) => (e as { chapter: number }).chapter);
    expect(doneChapters).toEqual([10, 11, 12]);
  });

  it("失败后 gate 返回 retry → 同章重写成功", async () => {
    let attempts = 0;
    const { events, deps } = harness(
      async () => {
        attempts++;
        if (attempts === 1) throw new Error("网络断了");
        return { words: 2000 };
      },
      { "after-failure:10": "retry" }
    );
    await runQueue(10, 10, deps);
    expect(attempts).toBe(2);
    expect(events.filter((e) => e.type === "chapter-failed")).toHaveLength(1);
    expect(events.filter((e) => e.type === "chapter-done")).toHaveLength(1);
  });

  it("失败后 gate 返回 skip → 放弃本章继续下一章", async () => {
    const { events, deps } = harness(
      async (chapter: number) => {
        if (chapter === 10) throw new Error("坏了");
        return { words: 1000 };
      },
      { "after-failure:10": "skip" }
    );
    await runQueue(10, 11, deps);
    const done = events.filter((e) => e.type === "chapter-done").map((e) => (e as { chapter: number }).chapter);
    expect(done).toEqual([11]);
    expect(events.some((e) => e.type === "queue-finished")).toBe(true);
  });

  it("失败后 gate 返回 stop → 立即结束且不发 queue-finished", async () => {
    const { events, deps } = harness(
      async () => {
        throw new Error("no");
      },
      { "after-failure": "stop" }
    );
    await runQueue(10, 12, deps);
    expect(events.some((e) => e.type === "queue-finished")).toBe(false);
    expect(events.filter((e) => e.type === "chapter-failed")).toHaveLength(1);
  });

  it("QuotaBlockedError → 停在当章前：发 quota-block、不记失败、不进下一章", async () => {
    const seen: number[] = [];
    const { events, deps } = harness(async (chapter: number) => {
      seen.push(chapter);
      if (chapter === 11) throw new QuotaBlockedError("今日额度用完");
      return { words: 1000 };
    });
    await runQueue(10, 13, deps);
    expect(seen).toEqual([10, 11]); // 12/13 没烧
    expect(events.some((e) => e.type === "quota-block")).toBe(true);
    expect(events.some((e) => e.type === "chapter-failed")).toBe(false);
    expect(events.some((e) => e.type === "queue-finished")).toBe(false);
  });

  it("reduce 全事件回放驱动序列 → 终态与 Chip 文案一致", async () => {
    const { events, deps } = harness(async (chapter: number) => {
      if (chapter === 11) throw new Error("boom");
      return { words: 1500 };
    }, { "after-failure:11": "skip" });
    await runQueue(10, 12, deps);
    // 把 skip 事件也喂给 reducer（驱动侧由 UI 点击 dispatch）
    let s = start();
    for (const ev of events) {
      if (ev.type === "chapter-failed" && ev.chapter === 11) {
        s = transition(s, ev);
        s = transition(s, { type: "skip", chapter: 11 });
        continue;
      }
      s = transition(s, ev);
    }
    expect(s.finished).toBe(true);
    expect(s.completed.map((c) => c.chapter)).toEqual([10, 12]);
    expect(queueProgressLabel(s)).toBe("3/3 全部完成");
  });
});
