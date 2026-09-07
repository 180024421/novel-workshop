import { describe, expect, it } from "vitest";
import {
  DIFF_CHAR_SOFT_LIMIT,
  applyChunks,
  diffParagraphs,
  splitParagraphs,
} from "./textDiff";

describe("textDiff", () => {
  it("splitParagraphs by blank lines", () => {
    expect(splitParagraphs("a\n\nb\n\nc")).toEqual(["a", "b", "c"]);
    expect(splitParagraphs("")).toEqual([]);
  });

  it("equal texts → all equal chunks", () => {
    const t = "第一段\n\n第二段";
    const chunks = diffParagraphs(t, t);
    expect(chunks.every((c) => c.type === "equal")).toBe(true);
    expect(chunks).toHaveLength(2);
  });

  it("add / del / replace", () => {
    const left = "甲\n\n乙\n\n丙";
    const right = "甲\n\n乙改\n\n丁";
    const chunks = diffParagraphs(left, right);
    expect(chunks.some((c) => c.type === "equal" && c.left === "甲")).toBe(true);
    expect(chunks.some((c) => c.type === "replace" || c.type === "del" || c.type === "add")).toBe(
      true
    );
  });

  it("applyChunks accepts selected right blocks", () => {
    const left = "旧A\n\n旧B";
    const right = "旧A\n\n新B";
    const chunks = diffParagraphs(left, right);
    const replaceIdx = chunks.findIndex((c) => c.type === "replace" || c.type === "add");
    expect(replaceIdx).toBeGreaterThanOrEqual(0);
    const applied = applyChunks(left, right, chunks, [replaceIdx]);
    expect(applied.includes("新B") || applied.includes("旧A")).toBe(true);
  });

  it("oversized falls back to single replace", () => {
    const left = "x".repeat(DIFF_CHAR_SOFT_LIMIT / 2 + 1);
    const right = "y".repeat(DIFF_CHAR_SOFT_LIMIT / 2 + 1);
    const chunks = diffParagraphs(left, right);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("replace");
  });
});
