/**
 * ================================================
 * FLOW: Auto Chapter-Continuation Queue（自动续章队列）
 * SCREEN 2 of 4: 运行态 ｜ SCREEN 3 of 4: 失败介入态 ｜ SCREEN 4 of 4: 完成汇总态
 * ------------------------------------------------
 * ENTRY:  QueueProgressChip 点开 / 队列启动后自动展开
 * EXIT:   汇总态「返回工作台」→ 退出 flow（onDismiss）
 * BRANCH: 介入态 重试/跳过 → Screen 2；停止 → Screen 4（部分汇总）
 * ================================================
 * 铁律对照：AI 失败信息内联展示（不用 Toast）；每章成功即落盘，暂停/停止不回收。
 */
import { Alert, Button, Flex, Progress, Tag } from "antd";
import { queueProgress } from "./queueLogic";
import type { ChapterQueueState, QueueAction } from "./types";
import "./QueuePanel.css";

export type QueuePanelProps = {
  state: ChapterQueueState;
  onAction: (a: QueueAction) => void;
  /** 跳章（先 flush 保存，父层负责） */
  onJumpChapter: (chapter: number) => void;
  onDismiss: () => void;
};

export function QueuePanel({ state, onAction, onJumpChapter, onDismiss }: QueuePanelProps) {
  const { done, total, percent } = queueProgress(state);
  const totalWords = state.completed.reduce((sum, c) => sum + c.words, 0);
  const intervention = state.pausedForReview || state.quotaBlocked;

  /* STATE: running — 进度条 + 当前章 + 暂停；失败条目行内展开 */
  /* STATE: intervention — 红标 Alert + 每章「重试/跳过」+ 「停止队列」 */
  /* STATE: summary — 成功/失败/跳过/字数汇总 + 章清单可跳转 */
  if (!state.running && !intervention && !state.finished) return null;

  return (
    <div className="wq-panel">
      <Flex align="center" justify="space-between" gap={8}>
        <strong className="wq-panel-title">
          {state.finished ? "续章完成" : intervention ? "队列等待介入" : "自动续章进行中"}
        </strong>
        <Flex gap={6} align="center">
          <span className="wq-panel-count">
            {done}/{total} 章
          </span>
          {state.running && (
            <Button size="small" onClick={() => onAction({ type: "pause" })}>
              暂停
            </Button>
          )}
          {(intervention || state.finished) && (
            <Button size="small" type="primary" onClick={onDismiss}>
              {state.finished ? "返回工作台" : "收起"}
            </Button>
          )}
        </Flex>
      </Flex>

      <Progress
        percent={percent}
        size="small"
        status={state.running ? "active" : intervention ? "exception" : "success"}
      />

      {state.running && state.currentChapter != null && (
        <div className="wq-current">正在写第{state.currentChapter}章…（挂机可读别的，写完自动进下一章）</div>
      )}

      {state.quotaBlocked && (
        <Alert
          type="warning"
          showIcon
          message="已停在额度线前"
          description="今日额度不足以再开一章，队列没有烧穿；补充额度或换渠道后继续。"
          action={
            <Button size="small" type="primary" ghost onClick={() => onAction({ type: "resume" })}>
              继续
            </Button>
          }
          style={{ marginTop: 8 }}
        />
      )}

      {intervention && !state.quotaBlocked && state.failures.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={`连续失败 ${state.consecutiveFailures} 次，已自动暂停`}
          description="已生成的章节都已落盘。逐章处理后即可继续。"
          style={{ marginTop: 8 }}
        />
      )}

      {state.failures.length > 0 && (
        <div className="wq-fails">
          {state.failures.map((f) => (
            <div key={f.chapter} className="wq-fail-row">
              <Tag color="error">第{f.chapter}章</Tag>
              <span className="wq-fail-reason" title={f.reason}>
                {f.reason}
              </span>
              <Button size="small" type="link" onClick={() => onAction({ type: "retry", chapter: f.chapter })}>
                重试
              </Button>
              <Button size="small" type="link" onClick={() => onAction({ type: "skip", chapter: f.chapter })}>
                跳过
              </Button>
            </div>
          ))}
          {intervention && (
            <Button size="small" danger onClick={() => onAction({ type: "stop" })}>
              停止队列（保留已写章节）
            </Button>
          )}
        </div>
      )}

      {state.finished && (
        <div className="wq-summary">
          <Flex gap={16} className="wq-stats">
            <span>
              成功 <b className="wq-ok">{state.completed.length}</b>
            </span>
            <span>
              失败 <b className="wq-bad">{state.failures.length}</b>
            </span>
            {state.skipped.length > 0 && (
              <span>
                跳过 <b>{state.skipped.length}</b>
              </span>
            )}
            <span>
              共 <b>{totalWords.toLocaleString()}</b> 字
            </span>
          </Flex>
          <div className="wq-list">
            {state.completed.map((c) => (
              <button type="button" key={c.chapter} className="wq-link" onClick={() => onJumpChapter(c.chapter)}>
                第{c.chapter}章 · {c.words.toLocaleString()} 字
              </button>
            ))}
            {state.failures.map((f) => (
              <button type="button" key={`f${f.chapter}`} className="wq-link wq-link-bad" onClick={() => onJumpChapter(f.chapter)}>
                第{f.chapter}章 · 失败
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
