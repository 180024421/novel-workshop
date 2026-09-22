import { describe, expect, it } from "vitest";
import { buildPreflight, cny, formatQuotaTip, quotaShortfall } from "./preflight";

describe("buildPreflight", () => {
  it("额度充足 → ok=true 无弹窗（主按钮直接执行）", () => {
    const p = buildPreflight({ estimatedCostCny: 0.35, remainingQuotaCny: 12 });
    expect(p.ok).toBe(true);
    expect(p.blockReason).toBeUndefined();
    expect(p.estimatedCost).toBe("¥0.35");
  });

  it("边界：费用恰好等于剩余额度 → 放行", () => {
    expect(buildPreflight({ estimatedCostCny: 5, remainingQuotaCny: 5 }).ok).toBe(true);
  });

  it("额度不足 → quota 阻断", () => {
    const p = buildPreflight({ estimatedCostCny: 3.2, remainingQuotaCny: 1 });
    expect(p.ok).toBe(false);
    expect(p.blockReason).toBe("quota");
  });

  it("负数预估按 0 显示但仍正常比较；license 失效直接阻断", () => {
    expect(buildPreflight({ estimatedCostCny: -1, remainingQuotaCny: 2 }).estimatedCost).toBe(cny(0));
    expect(
      buildPreflight({ estimatedCostCny: 0.1, remainingQuotaCny: 99, licenseOk: false }).ok
    ).toBe(false);
  });

  it("tip 一行显示「本次预估 · 今日剩余」", () => {
    const p = buildPreflight({ estimatedCostCny: 0.5, remainingQuotaCny: 3 });
    expect(formatQuotaTip(p)).toBe("本次预估 ¥0.50 · 今日剩余 ¥3.00");
    expect(formatQuotaTip({ ok: true })).toBe("");
  });

  it("缺口只在不为负时给出", () => {
    expect(quotaShortfall(3, 1)).toBe("¥2.00");
    expect(quotaShortfall(1, 3)).toBe("");
  });
});
