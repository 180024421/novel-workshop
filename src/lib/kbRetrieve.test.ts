import { describe, expect, it } from "vitest";
import { rerankChunksByCosine } from "./kbRetrieve";
import type { KbChunk } from "../types";

function chunk(id: string, text: string): KbChunk {
  return { id, source: "t", text, tags: [] };
}

describe("rerankChunksByCosine", () => {
  it("orders by cosine similarity to query", () => {
    const query = [1, 0, 0];
    const items = [
      { chunk: chunk("far", "a"), vector: [0, 1, 0] },
      { chunk: chunk("near", "b"), vector: [0.9, 0.1, 0] },
      { chunk: chunk("mid", "c"), vector: [0.5, 0.5, 0] },
    ];
    const ranked = rerankChunksByCosine(query, items, 2);
    expect(ranked.map((c) => c.id)).toEqual(["near", "mid"]);
  });

  it("respects limit and empty", () => {
    expect(rerankChunksByCosine([1, 0], [], 3)).toEqual([]);
    const one = [{ chunk: chunk("x", "t"), vector: [1, 0] }];
    expect(rerankChunksByCosine([1, 0], one, 0)).toEqual([]);
  });
});
