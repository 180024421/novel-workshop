import { describe, expect, it } from "vitest";
import {
  chapterBadgeState,
  findChapterListLine,
  insertChapterLineOrdered,
  removeChapterListLineExact,
  renameChapterInVolumeMd,
} from "./chapterOps";

const VOL_MD = `# 第2卷 风起云涌

## 本卷简介

主线推进。

## 章节列表

- 第10章 旧标题甲 —— 章核A｜钩子A
- 第11章 夜探 —— 章核B｜钩子B

## 分章细纲

## 第10章 旧标题甲

场次一。

### 第11章 夜探

场次二。
`;

describe("renameChapterInVolumeMd", () => {
  it("列表行只换标题，保留 —— 尾注", () => {
    const out = renameChapterInVolumeMd(VOL_MD, "第10章", "新标题");
    expect(out).toContain("- 第10章 新标题 —— 章核A｜钩子A");
    expect(out).toContain("- 第11章 夜探 —— 章核B｜钩子B");
  });

  it("同步改各级细纲标题行，不误伤其他章", () => {
    const out = renameChapterInVolumeMd(VOL_MD, "第10章", "新标题");
    expect(out).toContain("## 第10章 新标题");
    expect(out).toContain("### 第11章 夜探");
    expect(out).not.toContain("旧标题甲");
  });

  it("空标题回退为「未命名」；无章号 id 原样返回", () => {
    expect(renameChapterInVolumeMd(VOL_MD, "第10章", "   ")).toContain("- 第10章 未命名");
    expect(renameChapterInVolumeMd(VOL_MD, "附录", "x")).toBe(VOL_MD);
  });
});

describe("目录行删除/撤销/插序", () => {
  it("removeChapterListLineExact 返回被删行且可被 ordered 插回原位", () => {
    const { md, removedLine } = removeChapterListLineExact(VOL_MD, "第10章");
    expect(removedLine).toBe("- 第10章 旧标题甲 —— 章核A｜钩子A");
    expect(findChapterListLine(md, "第10章")).toBeNull();
    const restored = insertChapterLineOrdered(md, "第10章", removedLine!);
    expect(restored).toBe(VOL_MD); // 删除→撤销完全还原
    // 第11章之前插入 → 顺序恢复
    const idx10 = restored.indexOf("第10章 旧标题甲");
    const idx11 = restored.indexOf("- 第11章");
    expect(idx10).toBeGreaterThan(-1);
    expect(idx10).toBeLessThan(idx11);
  });

  it("insertChapterLineOrdered 按章号归位（10 在 11 前、20 在 11 后）", () => {
    const out = insertChapterLineOrdered(VOL_MD, "第20章", "- 第20章 终局");
    expect(out.indexOf("- 第11章")).toBeLessThan(out.indexOf("- 第20章"));
    const out2 = insertChapterLineOrdered(VOL_MD, "第9章", "- 第9章 序章");
    expect(out2.indexOf("- 第9章")).toBeLessThan(out2.indexOf("- 第10章"));
  });

  it("remove 不存在的章返回 null 且不改文本", () => {
    const { md, removedLine } = removeChapterListLineExact(VOL_MD, "第99章");
    expect(removedLine).toBeNull();
    expect(md).toBe(VOL_MD);
  });
});

describe("chapterBadgeState", () => {
  it("hasChapter → done，否则 draft；override 优先", () => {
    expect(chapterBadgeState({ hasChapter: true })).toBe("done");
    expect(chapterBadgeState({ hasChapter: false })).toBe("draft");
    expect(chapterBadgeState({ hasChapter: true }, "generating")).toBe("generating");
    expect(chapterBadgeState({ hasChapter: false }, "failed")).toBe("failed");
  });
});
