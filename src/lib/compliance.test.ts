import { describe, expect, it } from "vitest";
import {
  applyComplianceSuggestion,
  complianceRiskScore,
  parseComplianceRules,
  scanCompliance,
} from "./compliance";

describe("compliance", () => {
  it("parses rules markdown", () => {
    const rules = parseComplianceRules(`
# x
- 自杀教程 | 高危 | 删改
- 血腥淋漓 | 建议 | 收敛
`);
    expect(rules).toHaveLength(2);
    expect(rules[0].level).toBe("高危");
    expect(rules[0].suggestion).toBe("删改");
  });

  it("scans and scores", () => {
    const rules = parseComplianceRules("- 血腥淋漓 | 建议 | 收敛感官描写\n- 炸弹制作 | 高危 | 删除步骤");
    const hits = scanCompliance("现场血腥淋漓，还有炸弹制作说明。", rules);
    expect(hits.length).toBe(2);
    expect(hits.some((h) => h.level === "高危")).toBe(true);
    const risk = complianceRiskScore(hits);
    expect(risk.score).toBeLessThan(20);
    const next = applyComplianceSuggestion("血腥淋漓的场面", hits.find((h) => h.word === "血腥淋漓")!);
    expect(next).toContain("收敛");
  });
});
