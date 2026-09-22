/**
 * ================================================
 * FLOW: Auto Chapter-Continuation Queue（自动续章队列）
 * SCREEN 1 of 4: Queue Launch Bar（队列启动条）
 * ------------------------------------------------
 * ENTRY:  工作台完成态 Composer 旁「再写 N 章」/ 侧栏队列入口
 * EXIT:   「启动续章」→ Screen 2 运行态（父层拉起 runQueue）
 * BRANCH: 额度/授权预检不过 → 按钮禁用 + Tooltip 原因（不弹窗，Flow D 合并位）
 * ================================================
 */
import { useState } from "react";
import { Button, Flex, InputNumber, Tooltip, Typography } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { cny } from "./preflight";

export type QueueLaunchBarProps = {
  /** 默认写到第几章（serialPlan buffer 推算，父层给） */
  defaultTarget: number;
  /** 下一章起点 = 当前最大完成章号 + 1 */
  startChapter: number;
  /** 单章预估（CNY）；F6：按「共 N 章」实时折算，避免只报 1 章的钱 */
  costPerChapter?: number;
  remainingQuota?: string;
  /** 有值 → 启动按钮禁用并提示原因（如「今日额度仅剩 ¥3，不够 1 章」） */
  blockReason?: string;
  launching?: boolean;
  onStart: (targetChapter: number) => void;
};

export function QueueLaunchBar(p: QueueLaunchBarProps) {
  const [target, setTarget] = useState<number>(Math.max(p.defaultTarget, p.startChapter));
  const count = Math.max(0, target - p.startChapter + 1);
  const totalEstimate =
    p.costPerChapter != null && Number.isFinite(p.costPerChapter)
      ? cny(p.costPerChapter * count)
      : null;

  return (
    /* STATE: default — 步进器 + 费用/额度一行，启动可用 */
    /* STATE: blocked — blockReason 有值，启动禁用，Tooltip 说明 */
    /* STATE: launching — 启动中按钮 loading，防重复点击 */
    <Flex vertical gap={4} className="wq-launch">
      <Flex align="center" gap={8} wrap>
        <Typography.Text className="wq-launch-label">自动续章 · 写到第</Typography.Text>
        <InputNumber<number>
          size="small"
          min={p.startChapter}
          max={p.startChapter + 500}
          value={target}
          onChange={(v) => setTarget(v ?? target)}
          style={{ width: 76 }}
          aria-label="目标章号"
        />
        <Typography.Text className="wq-launch-label">章（共 {count} 章）</Typography.Text>
        <Tooltip title={p.blockReason || undefined}>
          <span>
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={p.launching}
              disabled={Boolean(p.blockReason)}
              onClick={() => p.onStart(target)}
            >
              启动续章
            </Button>
          </span>
        </Tooltip>
      </Flex>
      {(totalEstimate || p.remainingQuota) && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {totalEstimate ? `${count} 章合计预估 ${totalEstimate}` : ""}
          {totalEstimate && p.remainingQuota ? " · " : ""}
          {p.remainingQuota ? `今日剩余额度 ${p.remainingQuota}` : ""}
        </Typography.Text>
      )}
    </Flex>
  );
}
