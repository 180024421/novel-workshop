import { describe, expect, it } from "vitest";
import {
  wordGateStatus,
  estimateMaxTokens,
  parseTargetWordsFromTranscript,
  resolveChapterTargetWords,
  parseScenePlan,
  fallbackScenePlan,
  normalizePlanBudgets,
  reportHasMissingBeats,
  isWholeChapterReplacementSane,
} from "./writePipelineUtils";

describe("writePipelineUtils", () => {
  it("wordGateStatus under/ok/over", () => {
    expect(wordGateStatus(700, 2500, 0.9, 1.15)).toBe("under");
    expect(wordGateStatus(2300, 2500, 0.9, 1.15)).toBe("ok");
    expect(wordGateStatus(3000, 2500, 0.9, 1.15)).toBe("over");
  });

  it("estimateMaxTokens scales with target", () => {
    expect(estimateMaxTokens(2500)).toBeGreaterThanOrEqual(6000);
    expect(estimateMaxTokens(5000)).toBeGreaterThan(estimateMaxTokens(2500));
  });

  it("parseTargetWordsFromTranscript", () => {
    expect(parseTargetWordsFromTranscript("请写约2500字")).toBe(2500);
    expect(parseTargetWordsFromTranscript("目标 3000 字左右")).toBe(3000);
    expect(parseTargetWordsFromTranscript("随便聊聊")).toBeNull();
  });

  it("resolves chapter target from transcript before toolbar and default", () => {
    expect(resolveChapterTargetWords("先写 1800 字，后来目标 3200 字", 2600, 2500)).toBe(
      3200
    );
    expect(resolveChapterTargetWords("没有提字数", 2600, 2500)).toBe(2600);
    expect(resolveChapterTargetWords("没有提字数", undefined, 2400)).toBe(2400);
    expect(resolveChapterTargetWords("没有提字数", undefined, undefined)).toBe(2500);
  });

  it("parseScenePlan from markdown list", () => {
    const md = `1. 开场｜800\n2. 冲突｜1000\n3. 收束｜700`;
    const plan = parseScenePlan(md);
    expect(plan.length).toBe(3);
    expect(plan[0].budget).toBe(800);
    expect(plan.map((p) => p.budget).reduce((a, b) => a + b, 0)).toBe(2500);
  });

  it("parseScenePlan ignores summary rows", () => {
    const md = `1. 开场｜800\n2. 冲突｜1000\n合计字数｜1800`;
    expect(parseScenePlan(md)).toEqual([
      { title: "开场", budget: 800 },
      { title: "冲突", budget: 1000 },
    ]);
  });

  it.each([
    ["### 缺失或偏离\n无缺失。", false],
    ["### 缺失或偏离\n本章无明显缺失", false],
    ["### 缺失或偏离\n- 未发现遗漏", false],
    ["### 缺失或偏离\n- 缺了场次B", true],
  ])("detects missing beats in %j", (report, expected) => {
    expect(reportHasMissingBeats(report)).toBe(expected);
  });

  it("rejects empty or truncated whole-chapter replacements", () => {
    const oldBody = "旧正文内容".repeat(100);
    expect(isWholeChapterReplacementSane(oldBody, "   ")).toBe(false);
    expect(isWholeChapterReplacementSane(oldBody, "短稿".repeat(20))).toBe(false);
    expect(isWholeChapterReplacementSane(oldBody, "新正文内容".repeat(90))).toBe(true);
  });

  it("fallbackScenePlan splits target", () => {
    const plan = fallbackScenePlan("## 场次\n- 开场\n- 冲突\n- 收束", 2400);
    expect(plan.length).toBeGreaterThanOrEqual(3);
    const sum = plan.reduce((a, b) => a + b.budget, 0);
    expect(sum).toBe(2400);
  });

  it("normalizePlanBudgets scales budgets proportionally to target", () => {
    const plan = normalizePlanBudgets(
      [
        { title: "开场", budget: 1 },
        { title: "冲突", budget: 2 },
        { title: "收束", budget: 1 },
      ],
      2400
    );

    expect(plan).toEqual([
      { title: "开场", budget: 600 },
      { title: "冲突", budget: 1200 },
      { title: "收束", budget: 600 },
    ]);
    expect(plan.reduce((sum, scene) => sum + scene.budget, 0)).toBe(2400);
  });

  it("normalizePlanBudgets falls back for empty or zero-sum plans", () => {
    for (const plan of [
      normalizePlanBudgets([], 2500),
      normalizePlanBudgets(
        [
          { title: "开场", budget: 0 },
          { title: "收束", budget: 0 },
        ],
        2500
      ),
    ]) {
      expect(plan.length).toBeGreaterThanOrEqual(3);
      expect(plan.reduce((sum, scene) => sum + scene.budget, 0)).toBe(2500);
    }
  });
});
