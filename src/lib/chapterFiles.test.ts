import { describe, expect, it } from "vitest";
import {
  buildChapterIndex,
  chapterDirSignature,
  parseChapterFileName,
} from "./chapterFiles";

describe("chapterFiles", () => {
  it("parses chapter file names", () => {
    expect(parseChapterFileName("第1章_开端.md")).toEqual({
      id: "第1章",
      title: "开端",
    });
    expect(parseChapterFileName("第12章.md")).toEqual({
      id: "第12章",
      title: "未命名",
    });
    expect(parseChapterFileName("readme.md")).toBeNull();
  });

  it("builds index and signature", () => {
    const files = [
      { name: "第2章_乙.md", path: "/c/第2章_乙.md", mtimeMs: 2, size: 20 },
      { name: "第1章_甲.md", path: "/c/第1章_甲.md", mtimeMs: 1, size: 10 },
    ];
    const idx = buildChapterIndex(files);
    expect(idx.get("第1章")?.title).toBe("甲");
    expect(idx.get("第2章")?.path).toContain("第2章");
    const sig = chapterDirSignature(files);
    expect(sig).toContain("第1章_甲.md:1:10");
    expect(chapterDirSignature(files)).toBe(sig);
  });
});
