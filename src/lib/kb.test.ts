import { describe, expect, it } from "vitest";
import {
  chapterKbSource,
  chunkText,
  retrieveChunks,
} from "./kb";

describe("kb retrieveChunks sourcePrefix", () => {
  const chunks = [
    ...chunkText("chapter:第1章", "甲乙丙丁战斗开场".repeat(20), ["战斗"]),
    ...chunkText("chapter:第2章", "对白与感情戏缓慢推进".repeat(20), ["对白"]),
    ...chunkText("refs/范文A.txt", "环境描写雨夜山城".repeat(20), ["环境"]),
  ];

  it("filters by chapter: prefix", () => {
    const hits = retrieveChunks(chunks, "战斗", 5, [], { sourcePrefix: "chapter:" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source.startsWith("chapter:"))).toBe(true);
  });

  it("filters by exact chapter source", () => {
    const src = chapterKbSource("第2章");
    const hits = retrieveChunks(chunks, "对白", 5, [], { sourcePrefix: src });
    expect(hits.every((h) => h.source === src)).toBe(true);
  });

  it("returns empty when prefix matches nothing", () => {
    expect(retrieveChunks(chunks, "战斗", 5, [], { sourcePrefix: "volume:x" })).toEqual([]);
  });
});
