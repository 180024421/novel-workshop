/**
 * ================================================
 * FLOW: Auto Chapter-Continuation Queue（自动续章队列）
 * SCREEN 2 of 4（常驻件）: Progress Chip（进度胶囊）
 * ------------------------------------------------
 * ENTRY:  队列启动后常驻工作台顶栏 + 侧栏角标
 * EXIT:   点 Chip → 展开 QueuePanel（Screen 2/3/4 详情）
 * BRANCH: Popover 内 暂停/继续/停止，挂机时可快速干预
 * ================================================
 */
import { Badge, Button, Popover, Progress, Tag, theme } from "antd";
import { queueProgress, queueProgressLabel } from "./queueLogic";
import type { ChapterQueueState, QueueAction } from "./types";

export type QueueProgressChipProps = {
  state: ChapterQueueState;
  onAction: (a: QueueAction) => void;
  /** 点击 Chip 主体：滚到/展开队列面板 */
  onOpen?: () => void;
};

export function QueueProgressChip({ state, onAction, onOpen }: QueueProgressChipProps) {
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
          <Button size="small" type="text" onClick={onOpen}>
            查看详情
          </Button>
          {state.running ? (
            <Button size="small" onClick={() => onAction({ type: "pause" })}>
              暂停
            </Button>
          ) : state.finished ? null : (
            <Button size="small" type="primary" ghost onClick={() => onAction({ type: "resume" })}>
              继续
            </Button>
          )}
          {!state.finished && (
            <Button size="small" danger type="text" onClick={() => onAction({ type: "stop" })}>
              停止
            </Button>
          )}
        </div>
      }
    >
      <Badge dot={state.running} color={token.colorPrimary}>
        <Tag className="wq-chip" color={color} onClick={onOpen} style={{ cursor: "pointer" }}>
          {label}
        </Tag>
      </Badge>
    </Popover>
  );
}
