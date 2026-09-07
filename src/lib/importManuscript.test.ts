import { describe, expect, it } from "vitest";
import {
  mergeManuscriptChapterUp,
  removeManuscriptChapter,
  splitManuscript,
  updateManuscriptChapter,
} from "./importManuscript";

describe("splitManuscript", () => {
  it("splits 第N章 headers", () => {
    const text = `前言略

第1章 开端
甲甲甲

第2章 发展
乙乙乙
`;
    const ch = splitManuscript(text);
    expect(ch).toHaveLength(2);
    expect(ch[0]).toMatchObject({ id: "第1章", title: "开端" });
    expect(ch[0].body).toContain("甲甲甲");
    expect(ch[0].body).toContain("前言略");
    expect(ch[1]).toMatchObject({ id: "第2章", title: "发展", body: "乙乙乙" });
  });

  it("splits markdown # / ### 第N章", () => {
    const text = `# 第1章 夜雨

正文一

### 第2章 破晓

正文二`;
    const ch = splitManuscript(text);
    expect(ch.map((c) => c.id)).toEqual(["第1章", "第2章"]);
    expect(ch[0].title).toBe("夜雨");
    expect(ch[1].title).toBe("破晓");
  });

  it("splits Chapter N", () => {
    const text = `Chapter 1 Arrival
hello

Chapter 2 Escape
world`;
    const ch = splitManuscript(text);
    expect(ch).toHaveLength(2);
    expect(ch[0].id).toBe("第1章");
    expect(ch[0].title).toBe("Arrival");
    expect(ch[1].id).toBe("第2章");
  });

  it("fallback single chapter 第1章_导入", () => {
    const text = "没有章标题的一整篇正文。";
    const ch = splitManuscript(text);
    expect(ch).toHaveLength(1);
    expect(ch[0]).toEqual({ id: "第1章", title: "导入", body: text });
  });

  it("splits by --- with title lines when no chapter headers", () => {
    const text = `楔子
这是楔子正文

---

第一回
这是回目正文`;
    const ch = splitManuscript(text);
    expect(ch.length).toBeGreaterThanOrEqual(2);
    expect(ch[0].id).toBe("第1章");
    expect(ch[0].title).toBe("楔子");
  });
});

describe("manuscript preview edits", () => {
  it("updates title, merges up, removes and renumbers", () => {
    let ch = [
      { id: "第1章", title: "甲", body: "a" },
      { id: "第2章", title: "乙", body: "b" },
      { id: "第3章", title: "丙", body: "c" },
    ];
    ch = updateManuscriptChapter(ch, 1, { title: "乙改" });
    expect(ch[1].title).toBe("乙改");
    ch = mergeManuscriptChapterUp(ch, 1);
    expect(ch).toHaveLength(2);
    expect(ch[0].body).toContain("a");
    expect(ch[0].body).toContain("b");
    expect(ch[1].id).toBe("第2章");
    ch = removeManuscriptChapter(ch, 0, true);
    expect(ch).toHaveLength(1);
    expect(ch[0].id).toBe("第1章");
  });
});
