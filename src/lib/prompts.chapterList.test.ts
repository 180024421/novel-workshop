import { describe, expect, it } from "vitest";
import { parseChapterList } from "./prompts";

describe("parseChapterList", () => {
  it("prefers ## 章节列表 section over other chapter mentions", () => {
    const md = `# 第1卷 起势

## 本卷简介

前文提到第99章只是设定闲笔，不要当目录。

## 章节列表

- 第1章 开端 —— 钩子
- 第2章 冲突 —— 升级

## 分章细纲

## 第1章 开端

场次细节

## 第3章 细纲里多出来的章
`;
    const list = parseChapterList(md);
    expect(list.map((c) => c.id)).toEqual(["第1章", "第2章"]);
    expect(list[0].title).toContain("开端");
  });

  it("falls back to whole document when no 章节列表 section", () => {
    const md = `- 第1章 甲
- 第2章 乙`;
    const list = parseChapterList(md);
    expect(list.map((c) => c.id)).toEqual(["第1章", "第2章"]);
  });
});
