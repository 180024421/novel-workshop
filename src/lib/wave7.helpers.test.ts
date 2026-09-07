import { describe, expect, it } from "vitest";
import { craftFixPrompt } from "./craftFix";
import { mergeCraftStyle, mergeCraftTaboo } from "./craftUpgrade";
import {
  extractDialogueLines,
  groupVoiceIssuesByChapter,
  parseVoiceIssues,
  voiceFixPrompt,
} from "./voiceCheck";
import {
  assembleContextFromBlocks,
  formatContextBlocksForPrompt,
  toggleBlock,
} from "./writeContextPreview";
import { scoreFromProgress } from "./bookHealth";
import { buildWeeklyReport } from "./usageLedger";
import { DEMO_3MIN, DEMO_IMPORT_3MIN } from "./demoScript";

describe("craftFixPrompt", () => {
  it("includes hits", () => {
    const p = craftFixPrompt({
      body: "正文",
      hits: [{ kind: "工艺病", text: "改写命运", detail: "标语" }],
    });
    expect(p).toMatch(/改写命运/);
    expect(p).toMatch(/工艺/);
  });
});

describe("craftUpgrade", () => {
  it("merges style and taboo", () => {
    const s = mergeCraftStyle("- 对白口语\n");
    expect(s).toMatch(/写作工艺/);
    expect(s).toMatch(/对白口语/);
    const t = mergeCraftTaboo("- 总之\n");
    expect(t).toMatch(/改写命运/);
    expect(t).toMatch(/总之/);
  });
});

describe("voiceCheck", () => {
  it("extracts dialogue-ish lines", () => {
    const lines = extractDialogueLines('李云龙道："给我炸！"\n旁白一句。', "李云龙");
    expect(lines.length).toBeGreaterThan(0);
  });
  it("parses issue bullets", () => {
    const issues = parseVoiceIssues("- 第3章｜赵刚｜语气太粗｜老子弄死你");
    expect(issues[0]?.name).toBe("赵刚");
  });
  it("builds fix prompt and groups by chapter", () => {
    const issues = [
      { chapterId: "第1章", name: "陈刀", detail: "太文", sample: "余甚悦" },
      { chapterId: "第1章", name: "阿烬", detail: "太软", sample: "亲爱的" },
    ];
    const p = voiceFixPrompt({
      chapterId: "第1章",
      body: "陈刀道：「余甚悦。」",
      charactersMarkdown: "# 陈刀\n短句",
      issues,
    });
    expect(p).toMatch(/改写本章对白/);
    expect(groupVoiceIssuesByChapter(issues).get("第1章")?.length).toBe(2);
  });
});

describe("writeContextPreview", () => {
  it("assembles enabled blocks and formats prompt", () => {
    const blocks = [
      { id: "1", kind: "summary" as const, title: "摘要", text: "A", enabled: true },
      { id: "2", kind: "kb" as const, title: "KB", text: "B", enabled: false },
    ];
    expect(assembleContextFromBlocks(blocks)).toContain("摘要");
    expect(assembleContextFromBlocks(blocks)).not.toContain("KB");
    expect(toggleBlock(blocks, "2", true)[1].enabled).toBe(true);
    expect(formatContextBlocksForPrompt("X")).toMatch(/contextBlocks/);
  });
});

describe("bookHealth", () => {
  it("scores dimensions", () => {
    const r = scoreFromProgress({
      prog: {
        hasSeed: true,
        hasBible: true,
        hasOutline: true,
        chapterTotal: 2,
        beatsDone: 2,
        chaptersDone: 1,
        wordsTotal: 1000,
        chapterRows: [
          {
            id: "第1章",
            title: "a",
            volumeId: "第1卷",
            hasBeats: true,
            hasChapter: true,
            words: 1000,
          },
          {
            id: "第2章",
            title: "b",
            volumeId: "第1卷",
            hasBeats: true,
            hasChapter: false,
            words: 0,
          },
        ],
        volumeRows: [],
      },
      openHooks: 2,
      chaptersWithSummary: 1,
      craftHits: 0,
      craftSampleWords: 1000,
      craftSampleChapters: 1,
    });
    expect(r.score).toBeGreaterThan(50);
    expect(r.dimensions).toHaveLength(5);
    expect(r.dimensions.every((d) => d.max === 20)).toBe(true);
  });
});

describe("weeklyReport", () => {
  it("aggregates week", () => {
    const r = buildWeeklyReport(
      {
        days: {
          "2026-09-07": { words: 100, costCny: 1, writeOk: 1, writeFail: 1 },
          "2026-09-06": { words: 50, costCny: 0.5, writeOk: 1, writeFail: 0 },
        },
      },
      7,
      new Date("2026-09-07T12:00:00")
    );
    expect(r.words).toBe(150);
    expect(r.writeOk).toBe(2);
    expect(r.writeFail).toBe(1);
    expect(r.failRate).toBe(33.3);
  });
});

describe("demoScript", () => {
  it("has 5 steps for sample and import demos", () => {
    expect(DEMO_3MIN.steps.length).toBe(5);
    expect(DEMO_IMPORT_3MIN.steps.length).toBe(5);
  });
});
