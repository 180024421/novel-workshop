import { describe, expect, it } from "vitest";
import { formatChapterWriteReport } from "./ChapterTools";

describe("formatChapterWriteReport", () => {
  it("omits self-check copy when no beats report exists", () => {
    expect(formatChapterWriteReport(2375, 2500)).toBe(
      "已写入 约 2375 字（目标 2500，达标率 95%）"
    );
  });

  it("points to the tools area when a beats report exists", () => {
    expect(formatChapterWriteReport(2375, 2500, "已覆盖全部场次")).toBe(
      "已写入 约 2375 字（目标 2500，达标率 95%；自检见工具区）"
    );
  });
});
