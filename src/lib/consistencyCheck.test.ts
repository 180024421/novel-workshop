import { describe, expect, it } from "vitest";
import { parseConsistencyIssues } from "./consistencyCheck";
import { scoreFromProgress } from "./bookHealth";

describe("consistencyCheck", () => {
  it("parses issue lines", () => {
    const issues = parseConsistencyIssues(`
## 问题列表
- 第3章｜人物状态｜左手已断却又提刀
- 第5章｜器物｜令牌失踪后又出现
`);
    expect(issues).toHaveLength(2);
    expect(issues[0].kind).toBe("人物状态");
  });
});

describe("bookHealth compliance dimension", () => {
  it("includes compliance score", () => {
    const r = scoreFromProgress({
      prog: {
        hasSeed: true,
        hasBible: true,
        hasOutline: true,
        chapterTotal: 1,
        beatsDone: 1,
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
        ],
        volumeRows: [],
      },
      openHooks: 1,
      chaptersWithSummary: 1,
      craftHits: 0,
      craftSampleWords: 1000,
      craftSampleChapters: 1,
      complianceScore: 16,
      complianceDetail: "抽检",
      complianceHits: 2,
    });
    expect(r.dimensions.find((d) => d.id === "compliance")?.score).toBe(16);
  });
});
