import { describe, expect, it } from "vitest";
import { craftFixPrompt } from "./craftFix";
import { mergeCraftStyle, mergeCraftTaboo } from "./craftUpgrade";
import { extractDialogueLines, parseVoiceIssues } from "./voiceCheck";
import { assembleContextFromBlocks, toggleBlock } from "./writeContextPreview";

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
});

describe("writeContextPreview", () => {
  it("assembles enabled blocks", () => {
    const blocks = [
      { id: "1", kind: "summary" as const, title: "摘要", text: "A", enabled: true },
      { id: "2", kind: "kb" as const, title: "KB", text: "B", enabled: false },
    ];
    expect(assembleContextFromBlocks(blocks)).toContain("摘要");
    expect(assembleContextFromBlocks(blocks)).not.toContain("KB");
    expect(toggleBlock(blocks, "2", true)[1].enabled).toBe(true);
  });
});
