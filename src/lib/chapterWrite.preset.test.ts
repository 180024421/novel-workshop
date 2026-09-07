import { describe, expect, it } from "vitest";
import {
  createBatchSession,
  markBatchDone,
  markBatchFailed,
  sessionProgressLabel,
} from "./batchSession";
import { resolveWritePreset } from "./chapterWrite";
import type { AppSettings } from "../types";

const baseSettings = {
  defaultModel: "小说",
  stream: true,
  routeOutline: "复杂",
  routeChapter: "小说",
  routeCheck: "复杂",
} as AppSettings;

describe("resolveWritePreset", () => {
  it("defaults to quality", () => {
    expect(resolveWritePreset(baseSettings)).toBe("quality");
  });

  it("reads settings then override", () => {
    expect(resolveWritePreset({ ...baseSettings, writePreset: "fast" })).toBe("fast");
    expect(resolveWritePreset({ ...baseSettings, writePreset: "fast" }, "quality")).toBe(
      "quality"
    );
  });
});

describe("batchSession helpers", () => {
  it("tracks done / failed / pending", () => {
    let s = createBatchSession({
      from: 1,
      to: 3,
      preset: "fast",
      skipExisting: true,
      targetWords: 2500,
      delayMs: 0,
      chapterIds: ["第001章", "第002章", "第003章"],
    });
    s = markBatchDone(s, "第001章");
    s = markBatchFailed(s, "第002章", "timeout");
    expect(s.done).toEqual(["第001章"]);
    expect(s.failed).toEqual([{ chapterId: "第002章", error: "timeout" }]);
    expect(s.pending).toEqual(["第003章"]);
    expect(sessionProgressLabel(s)).toContain("1/3");
  });
});
