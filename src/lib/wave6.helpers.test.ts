import { describe, expect, it } from "vitest";
import { alignBeatsToBody, extractBeatSceneTitles } from "./beatsAlign";
import { formatForPlatform, appendWordCountFooter, sanitizeExportFileName } from "./platformFormat";
import { formatRecentSummariesForPrompt, parseSummaryText, type SummariesLedger } from "./summaries";
import { matchEntities, formatEntitiesForPrompt, type EntityCard } from "./entities";
import { bucketWords } from "./rhythm";
import { cosineSim } from "./embedding";

describe("beatsAlign", () => {
  it("extracts scene titles and aligns", () => {
    const beats = "## 场次\n- 开场遇敌\n- 夜袭炮楼\n## 章末钩子\n有人来了";
    expect(extractBeatSceneTitles(beats).length).toBeGreaterThanOrEqual(2);
    const rows = alignBeatsToBody(beats, "开场遇敌之后，夜袭炮楼打响。");
    expect(rows.some((r) => r.covered)).toBe(true);
  });
});

describe("platformFormat", () => {
  it("formats tomato with indent", () => {
    const out = formatForPlatform("第一段\n\n第二段", "tomato");
    expect(out.includes("　　")).toBe(true);
  });
  it("appends word footer once", () => {
    const a = appendWordCountFooter("正文", 100);
    expect(a).toMatch(/字数/);
    expect(appendWordCountFooter(a, 100).match(/字数/g)?.length).toBe(1);
  });
  it("sanitizes filename", () => {
    expect(sanitizeExportFileName('a/b:c')).toBe("a_b_c");
  });
});

describe("summaries", () => {
  it("formats recent before chapter", () => {
    const ledger: SummariesLedger = {
      updatedAt: "",
      items: [
        { chapterId: "第001章", title: "一", summary: "起", words: 1, updatedAt: "" },
        { chapterId: "第002章", title: "二", summary: "承", words: 1, updatedAt: "" },
        { chapterId: "第003章", title: "三", summary: "转", words: 1, updatedAt: "" },
      ],
    };
    const t = formatRecentSummariesForPrompt(ledger, "第003章", 5);
    expect(t).toContain("第001章");
    expect(t).toContain("第002章");
    expect(t).not.toContain("第003章");
  });
  it("parseSummaryText trims", () => {
    expect(parseSummaryText('"你好"')).toBe("你好");
  });
});

describe("entities", () => {
  it("matches names in query", () => {
    const list: EntityCard[] = [
      { id: "1", name: "苍云岭", kind: "地点", aliases: "苍云", description: "山", taboo: "" },
      { id: "2", name: "独立团", kind: "势力", aliases: "", description: "部队", taboo: "" },
    ];
    expect(matchEntities("军往苍云岭去", list).map((e) => e.name)).toContain("苍云岭");
    expect(formatEntitiesForPrompt(list.slice(0, 1))).toContain("地点");
  });
});

describe("rhythm/embedding helpers", () => {
  it("bucketWords", () => {
    expect(bucketWords(1000)).toBe("<1500");
    expect(bucketWords(4000)).toBe("≥3500");
  });
  it("cosineSim", () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });
});
