/**
 * 工作台布局重构（flow-web）共享类型。
 * 消费方：Flow A 写作主循环 / Flow B 章目录侧栏 / Flow C 自动续章队列 / Flow D 确认合并。
 * 数据源为真实 AppContext / useStudioDocument，本文件只定义 UI 状态契约。
 */

/** 本章写作所需的上游物料（设定/总纲/细纲）灯态 —— Flow A Screen 1 状态条 */
export type MaterialKey = "setup" | "outline" | "beats";
export type MaterialLampStatus = "ready" | "missing" | "stale";
export interface MaterialLamp {
  key: MaterialKey;
  label: string;
  status: MaterialLampStatus;
  /** missing/stale 时「就地补」按钮触发的动作 id */
  repairAction?: "gen-outline" | "gen-beats" | "gen-setup";
}

/** 侧栏章节条目状态角标 —— Flow B */
export type ChapterItemState = "draft" | "generating" | "done" | "queued" | "failed";

/** 侧栏章行视图数据（与 projectProgress.chapterRows 字段对齐，Phase C 直接透传）—— Flow B */
export interface ChapterRowView {
  id: string;
  title: string;
  volumeId: string;
  /** 正文文件已有内容 */
  hasChapter: boolean;
  /** 细纲目录里有这一章 */
  hasBeats: boolean;
  words?: number;
}

/** 自动续章队列 —— Flow C */
export interface QueueFailure {
  chapter: number;
  reason: string;
}
export interface ChapterQueueState {
  running: boolean;
  /** 写到第几章（绝对章号） */
  targetChapter: number;
  startChapter: number;
  currentChapter: number | null;
  completed: { chapter: number; words: number }[];
  failures: QueueFailure[];
  /** 连续失败 2 次自动暂停，等待人工介入 */
  pausedForReview: boolean;
  /** 本轮连续失败计数（成功/重试恢复即清零） */
  consecutiveFailures: number;
  skipped: number[];
  /** 额度/授权预检不过 → 停在当章之前，不烧穿 */
  quotaBlocked: boolean;
  /** 全部完成或用户停止 → 汇总卡显示 */
  finished: boolean;
}
export type QueueAction =
  | { type: "start"; targetChapter: number; startChapter: number }
  | { type: "retry"; chapter: number }
  | { type: "skip"; chapter: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" };

/** Flow D：生成前预检结果（费用确认合并进主按钮） */
export interface PreflightResult {
  ok: boolean;
  estimatedCost?: string;
  remainingQuota?: string;
  /** ok=false 时弹出唯一一次阻断对话框 */
  blockReason?: "quota" | "overwrite";
}
