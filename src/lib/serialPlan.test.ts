import { describe, expect, it } from "vitest";
import { chapterNum, computeSerialStatus } from "./serialPlan";
import type { ProjectProgress } from "./projectProgress";

describe("serialPlan", () => {
  it("computes buffer and risk", () => {
    expect(chapterNum("第12章")).toBe(12);
    const prog: ProjectProgress = {
      hasSeed: true,
      hasBible: true,
      hasOutline: true,
      chapterTotal: 5,
      beatsDone: 5,
      chaptersDone: 5,
      wordsTotal: 10000,
      chapterRows: [
        { id: "第1章", title: "a", volumeId: "第1卷", hasBeats: true, hasChapter: true, words: 2000 },
        { id: "第2章", title: "b", volumeId: "第1卷", hasBeats: true, hasChapter: true, words: 2000 },
        { id: "第3章", title: "c", volumeId: "第1卷", hasBeats: true, hasChapter: true, words: 2000 },
        { id: "第4章", title: "d", volumeId: "第1卷", hasBeats: true, hasChapter: true, words: 2000 },
        { id: "第5章", title: "e", volumeId: "第1卷", hasBeats: true, hasChapter: true, words: 2000 },
      ],
      volumeRows: [],
    };
    const danger = computeSerialStatus(prog, {
      publishedThrough: "第4章",
      dailyChapters: 1,
      startDate: "2026-01-01",
      updatedAt: "",
    });
    expect(danger.bufferChapters).toBe(1);
    expect(danger.risk).toBe("危");

    const ok = computeSerialStatus(prog, {
      publishedThrough: "第0章",
      dailyChapters: 1,
      startDate: "2026-01-01",
      updatedAt: "",
    });
    expect(ok.bufferChapters).toBe(5);
    expect(ok.risk).toBe("稳");
  });
});
