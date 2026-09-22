/**
 * ================================================
 * FLOW: Confirmation Dialog Consolidation（确认弹窗合并）
 * 纯逻辑层：生成前预检（费用/额度）装配 —— 供 Screen 1 按钮与 Screen 2 对话框共用
 * ------------------------------------------------
 * 规则：额度充足 ok=true → 主按钮直接执行，全程零弹窗；
 *      仅「额度不足」这一种情况配阻断对话框（Flow D Screen 2）。
 *      重写确认（覆盖已有正文）不走这里——维持现有 lib/confirm 的 AlertDialog。
 * ================================================
 */
import type { PreflightResult } from "./types";

export type PreflightInput = {
  /** 本次生成预估费用（元），来自 costEstimate.estimateCostCny */
  estimatedCostCny: number;
  /** 今日剩余额度（元）= 日预算 - 已用，来自 usageLedger */
  remainingQuotaCny: number;
  /** 授权失效也归入 quota 阻断（对话框文案分支） */
  licenseOk?: boolean;
};

export function cny(n: number): string {
  if (!Number.isFinite(n)) return "不限";
  return `¥${n.toFixed(2)}`;
}

export function buildPreflight(i: PreflightInput): PreflightResult {
  const estimatedCost = cny(Math.max(0, i.estimatedCostCny));
  const remainingQuota = cny(i.remainingQuotaCny);
  if (i.licenseOk === false) {
    return { ok: false, blockReason: "quota", estimatedCost, remainingQuota };
  }
  const enough = i.estimatedCostCny <= i.remainingQuotaCny;
  return enough
    ? { ok: true, estimatedCost, remainingQuota }
    : { ok: false, blockReason: "quota", estimatedCost, remainingQuota };
}

/** 按钮 hover 提示：一行显示本次花费与剩余（信息内联，不弹确认框） */
export function formatQuotaTip(p: PreflightResult): string {
  if (!p.estimatedCost && !p.remainingQuota) return "";
  return `本次预估 ${p.estimatedCost ?? "?"} · 今日剩余 ${p.remainingQuota ?? "?"}`;
}

/** 对话框「还差 ¥z」行；数据不足返回空串 */
export function quotaShortfall(estimatedCostCny: number, remainingQuotaCny: number): string {
  const gap = estimatedCostCny - remainingQuotaCny;
  return gap > 0 ? cny(gap) : "";
}
