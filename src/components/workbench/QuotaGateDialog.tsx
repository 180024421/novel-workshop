/**
 * ================================================
 * FLOW: Confirmation Dialog Consolidation（确认弹窗合并）
 * SCREEN 2 of 2: Quota Gate Dialog（额度不足对话框 —— 唯一保留的阻断弹窗位）
 * ------------------------------------------------
 * ENTRY:  Screen 1 PreflightButton 点击时 buildPreflight().ok=false
 * EXIT:   「去升级」/「换引擎渠道」→ 父层导航后关闭；「取消」→ 留在原页
 * BRANCH: 用户换渠道/补额度后再点主按钮 → Screen 1 直接开始（无弹窗）
 * ================================================
 * 场景铁律：全流程只有这里弹窗。信息克制——预估、剩余、还差多少，三行完事。
 */
import { Button, Modal, Typography } from "antd";
import { cny, quotaShortfall } from "./preflight";
import "./QueuePanel.css";

export type QuotaGateDialogProps = {
  open: boolean;
  onClose: () => void;
  estimatedCostCny: number;
  remainingQuotaCny: number;
  /** 授权失效变体：只留「去设置」一个出口 */
  licenseInvalid?: boolean;
  onUpgrade?: () => void;
  onSwitchChannel?: () => void;
};

export function QuotaGateDialog(p: QuotaGateDialogProps) {
  const gap = quotaShortfall(p.estimatedCostCny, p.remainingQuotaCny);

  return (
    /* STATE: default（quota）— 费用三行 + 换渠道 / 取消 / 去升级 */
    /* STATE: license-invalid — 授权失效，只给「去设置」出口 */
    <Modal
      open={p.open}
      onCancel={p.onClose}
      title={p.licenseInvalid ? "授权已失效" : "额度不够这次生成"}
      centered
      width={400}
      footer={
        p.licenseInvalid ? (
          <>
            <Button onClick={p.onClose}>取消</Button>
            <Button type="primary" danger onClick={p.onUpgrade}>
              去设置
            </Button>
          </>
        ) : (
          <>
            {p.onSwitchChannel && (
              <Typography.Link onClick={p.onSwitchChannel} style={{ marginRight: "auto" }}>
                换引擎渠道
              </Typography.Link>
            )}
            <Button onClick={p.onClose}>取消</Button>
            <Button type="primary" danger onClick={p.onUpgrade}>
              去升级
            </Button>
          </>
        )
      }
    >
      <div className="wqg-lines">
        <p>
          本次预估：<b>{cny(p.estimatedCostCny)}</b>
        </p>
        <p>
          今日剩余：<b>{cny(p.remainingQuotaCny)}</b>
          {!p.licenseInvalid && gap && <span className="wqg-gap">（还差 {gap}）</span>}
        </p>
        <p className="wqg-safe">
          {p.licenseInvalid
            ? "试用已到期或授权码失效，填入新授权码后即可继续。"
            : "已生成的章节都已落盘，不会丢；补充额度或换渠道后可从本章继续。"}
        </p>
      </div>
    </Modal>
  );
}
