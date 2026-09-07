import { describe, expect, it } from "vitest";
import { mergeLearnedStyle, parseStyleDraft } from "./styleLearn";

describe("styleLearn", () => {
  it("parses style draft and voice notes", () => {
    const raw = `## 句长与节奏
短句多。

## 人物声口补充（可选）
主角少废话。
`;
    const { styleMd, voiceNotes } = parseStyleDraft(raw);
    expect(styleMd).toMatch(/句长与节奏/);
    expect(voiceNotes).toMatch(/人物声口/);
  });

  it("merges learned style with craft", () => {
    const merged = mergeLearnedStyle("", "## 句长与节奏\n短");
    expect(merged).toMatch(/句长与节奏/);
  });
});
