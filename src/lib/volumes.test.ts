import { describe, expect, it } from "vitest";
import {
  appendChapterListLine,
  buildVolumeBeatsFromChapterEntries,
  emptyVolumeBeatsTemplate,
  extractChapterBeats,
  nextChapterNumber,
  parseVolumes,
  removeChapterListLine,
  reorderVolumeChaptersMd,
} from "./volumes";

describe("parseVolumes", () => {
  it("parses ## volume headings and chapters under each", () => {
    const md = `# 书名

## 第1卷 起势

- 第1章 开端 —— 钩子
- 第2章 冲突 —— 升级

## 第2卷 高潮

- 第3章 决战 —— 收束
`;
    const vols = parseVolumes(md);
    expect(vols).toHaveLength(2);
    expect(vols[0].id).toBe("第1卷");
    expect(vols[0].title).toBe("起势");
    expect(vols[0].chapters.map((c) => c.id)).toEqual(["第1章", "第2章"]);
    expect(vols[1].id).toBe("第2卷");
    expect(vols[1].chapters.map((c) => c.id)).toEqual(["第3章"]);
  });

  it("parses ### volume headings", () => {
    const md = `### 第1卷 暗线

- 第1章 伏笔
`;
    const vols = parseVolumes(md);
    expect(vols).toHaveLength(1);
    expect(vols[0].id).toBe("第1卷");
    expect(vols[0].chapters[0].id).toBe("第1章");
  });

  it("falls back to single volume when no volume headings", () => {
    const md = `- 第1章 甲
- 第2章 乙`;
    const vols = parseVolumes(md);
    expect(vols).toHaveLength(1);
    expect(vols[0].id).toBe("第1卷");
    expect(vols[0].chapters).toHaveLength(2);
  });
});

describe("reorderVolumeChaptersMd", () => {
  it("reorders chapter blocks and list lines without renumbering", () => {
    const md = `# 第1卷 开篇

## 本卷简介

目标

## 章节列表

- 第1章 开端 —— 钩子
- 第2章 发展 —— 升级
- 第3章 转折 —— 反转

## 分章细纲

## 第1章 开端

场次甲

## 第2章 发展

场次乙

## 第3章 转折

场次丙
`;
    const out = reorderVolumeChaptersMd(md, ["第2章", "第1章", "第3章"]);
    expect(out.indexOf("第2章 发展")).toBeLessThan(out.indexOf("第1章 开端"));
    const blocks = out.split(/\n## 第/);
    // list order: 第2 then 第1 then 第3
    expect(out).toMatch(/章节列表[\s\S]*第2章 发展[\s\S]*第1章 开端[\s\S]*第3章 转折/);
    expect(out).toContain("场次乙");
    expect(out).toContain("场次甲");
    // ids preserved
    expect(out).toContain("## 第2章 发展");
    expect(out).toContain("## 第1章 开端");
    void blocks;
  });
});

describe("extractChapterBeats", () => {
  it("extracts ## chapter section", () => {
    const md = `# 第1卷

## 第1章 开端

1. 场景甲
2. 场景乙

## 第2章 发展

1. 场景丙
`;
    const beat = extractChapterBeats(md, "第1章");
    expect(beat).toContain("场景甲");
    expect(beat).not.toContain("场景丙");
  });

  it("extracts ### chapter section", () => {
    const md = `### 第2章 转折

- 转折点

### 第3章 收束

- 结局
`;
    const beat = extractChapterBeats(md, "第2章");
    expect(beat).toContain("转折点");
    expect(beat).not.toContain("结局");
  });
});

describe("emptyVolumeBeatsTemplate", () => {
  it("exists and includes volume id and chapter list section", () => {
    const t = emptyVolumeBeatsTemplate("第1卷", "起势");
    expect(t).toContain("第1卷");
    expect(t).toContain("起势");
    expect(t).toMatch(/##\s*章节列表/);
    expect(t).toMatch(/##\s*分章细纲/);
  });
});

describe("bootstrap helpers", () => {
  it("builds volume beats from chapter entries", () => {
    const md = buildVolumeBeatsFromChapterEntries("第1卷", "导入", [
      { id: "第1章", title: "开端" },
      { id: "第2章", title: "冲突" },
    ]);
    expect(md).toContain("- 第1章 开端");
    expect(md).toContain("- 第2章 冲突");
  });

  it("appends and removes chapter list lines", () => {
    let md = emptyVolumeBeatsTemplate("第1卷");
    md = appendChapterListLine(md, "第1章", "开端");
    expect(md).toContain("- 第1章 开端");
    md = appendChapterListLine(md, "第2章", "发展");
    expect(md).toContain("- 第2章 发展");
    md = removeChapterListLine(md, "第1章");
    expect(md).not.toMatch(/第\s*1\s*章/);
    expect(md).toContain("- 第2章 发展");
  });

  it("nextChapterNumber", () => {
    expect(nextChapterNumber(["第1章", "第3章"])).toBe(4);
    expect(nextChapterNumber([])).toBe(1);
  });
});
