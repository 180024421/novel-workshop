import { describe, expect, it } from "vitest";
import {
  chapterNum,
  compareChapterNames,
  neighborChapter,
  pickPrevChapterFile,
} from "./chapterNav";

describe("chapterNav", () => {
  it("parses chapter numbers", () => {
    expect(chapterNum("第10章")).toBe(10);
    expect(chapterNum("第2章_开端.md")).toBe(2);
  });

  it("sorts 第10章 after 第2章", () => {
    expect(compareChapterNames("第2章_a.md", "第10章_b.md")).toBeLessThan(0);
  });

  it("picks numeric previous file", () => {
    const files = [
      { name: "第10章_十.md", path: "/10" },
      { name: "第2章_二.md", path: "/2" },
      { name: "第9章_九.md", path: "/9" },
    ];
    expect(pickPrevChapterFile(files, "第10章")?.path).toBe("/9");
  });

  it("neighbors from outline list", () => {
    const list = [
      { id: "第1章", title: "开" },
      { id: "第2章", title: "承" },
      { id: "第3章", title: "转" },
    ];
    expect(neighborChapter(list, "第2章", 1)?.id).toBe("第3章");
    expect(neighborChapter(list, "第2章", -1)?.title).toBe("开");
    expect(neighborChapter(list, "第3章", 1)).toBeNull();
  });
});
