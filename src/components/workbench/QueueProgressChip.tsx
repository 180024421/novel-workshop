/**
 * ================================================
 * FLOW: Auto Chapter-Continuation Queue（自动续章队列）
 * SCREEN 2 of 4（常驻件）: Progress Chip（进度胶囊）
 * ------------------------------------------------
 * ENTRY:  队列启动后常驻工作台顶栏 + 侧栏角标
 * EXIT:   点 Chip → Popover 快速干预（详情面板常驻右栏 Agent 下方）
 * BRANCH: Popover 内 继续/停止，挂机时可快速干预
 * ================================================
 */
import { Badge, Button, Popover, Progress, Tag, theme } from "antd";
import { queueProgress, queueProgressLabel } from "./queueLogic";
import type { ChapterQueueState, QueueAction } from "./types";

export type QueueProgressChipProps = {
  state: ChapterQueueState;
  onAction: (a: QueueAction) => void;
};

export function QueueProgressChip({ state, onAction }: QueueProgressChipProps) {
  const { token } = theme.useToken();
  const label = queueProgressLabel(state);
  if (!label) return null; // STATE: idle — 队列完全静默不占位
  const { done, total, percent } = queueProgress(state);

  const color = state.quotaBlocked || state.pausedForReview ? "error" : state.running ? "processing" : "success";

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={
        <div style={{ width: 200 }}>
          <Progress percent={percent} size="small" status={state.running ? "active" : "normal"} />
          <div style={{ fontSize: 12, margin: "2px 0 8px" }}>
            {done}/{total} 章 · {state.currentChapter ? `正在写第${state.currentChapter}章` : "等待开写"}
          </div>
          <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.65 }}>详情面板在右栏「Agent」下方</div>
          {!state.running && !state.finished ? (
            <Button size="small" type="primary" ghost onClick={() => onAction({ type: "resume" })}>
              继续
            </Button>
          ) : null}
          {!state.finished && (
            <Button size="small" danger type="text" onClick={() => onAction({ type: "stop" })}>
              停止
            </Button>
          )}
        </div>
      }
    >
      <Badge dot={state.running} color={token.colorPrimary}>
        <Tag className="wq-chip" color={color} style={{ cursor: "pointer" }}>
          {label}
        </Tag>
      </Badge>
    </Popover>
  );
}
