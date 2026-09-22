/**
 * ================================================
 * FLOW: Confirmation Dialog Consolidation（确认弹窗合并）
 * SCREEN 1 of 2: Preflight Button（主按钮内联预检 —— 额度充足零弹窗）
 * ------------------------------------------------
 * ENTRY:  替换现有「写本章 / 生成本章」按钮的 费用确认 + 额度检查 两段弹窗
 *         （改造锚点：ChapterTools.tsx:290-296、useStudioGenerate 的 confirmOverwrite 前置）
 * EXIT:   preflight.ok → 直接 onProceed()（无弹窗，立即开写）
 * BRANCH: quota 不足 → Screen 2 QuotaGateDialog；overwrite 确认 → 父层维持现有 AlertDialog
 * ================================================
 * 关键取舍：覆盖已有正文的「重写确认」不走本组件（铁律：破坏性操作才配阻断弹窗），
 *          按钮照常触发 onProceed，由父层 confirmOverwrite 处理。
 */
import { useState } from "react";
import { Button, Tooltip } from "antd";
import type { ButtonProps } from "antd";
import { formatQuotaTip } from "./preflight";
import { QuotaGateDialog } from "./QuotaGateDialog";
import type { PreflightResult } from "./types";
import "./QueuePanel.css";

export type PreflightButtonProps = {
  label: string;
  /** 父层用 buildPreflight 或运行时检查结果喂进来 */
  preflight: PreflightResult;
  /** 预检通过（或用户从对话框换渠道后重试）→ 真正开写 */
  onProceed: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** 对话框出口：去升级 / 换渠道（缺省则对话框不显示对应按钮） */
  onUpgrade?: () => void;
  onSwitchChannel?: () => void;
  /** 授权失效变体 */
  licenseInvalid?: boolean;
  /** 用于计算对话框「还差多少」的原始数值 */
  estimatedCostCny?: number;
  remainingQuotaCny?: number;
  buttonProps?: Omit<ButtonProps, "loading" | "disabled" | "onClick">;
};

export function PreflightButton(p: PreflightButtonProps) {
  const [gateOpen, setGateOpen] = useState(false);
  const tip = formatQuotaTip(p.preflight);
  const blocked = !p.preflight.ok && p.preflight.blockReason === "quota";

  function handleClick() {
    if (blocked || p.licenseInvalid) {
      setGateOpen(true); // 唯一弹窗位：额度不足
      return;
    }
    // ok=true 直接开始（零弹窗）；overwrite 阻断交给父层 onProceed 内现有确认
    p.onProceed();
  }

  const btn = (
    <Button
      type="primary"
      loading={p.loading}
      disabled={p.disabled}
      onClick={handleClick}
      {...p.buttonProps}
    >
      {p.label}
    </Button>
  );

  return (
    <>
      {/* STATE: default — hover 一行额度信息，点击直接开写 */}
      {/* STATE: quota-blocked — 按钮可点（点了才解释为什么不行），点击进 Screen 2 */}
      {tip ? (
        <Tooltip title={tip} placement="bottom">
          {blocked ? (
            <span className="wq-preflight-blocked">{btn}</span>
          ) : (
            btn
          )}
        </Tooltip>
      ) : (
        btn
      )}
      <QuotaGateDialog
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        estimatedCostCny={p.estimatedCostCny ?? 0}
        remainingQuotaCny={p.remainingQuotaCny ?? 0}
        licenseInvalid={p.licenseInvalid}
        onUpgrade={p.onUpgrade}
        onSwitchChannel={p.onSwitchChannel}
      />
    </>
  );
}
