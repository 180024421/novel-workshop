import { describe, expect, it } from "vitest";
import { bodyToXhtmlParagraphs, buildDocxBlob, buildEpubBlob } from "./exportRich";

describe("exportRich", () => {
  it("bodyToXhtmlParagraphs escapes and splits", () => {
    const html = bodyToXhtmlParagraphs("甲 & 乙\n\n丙<丁>");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;");
    expect(html.match(/<p>/g)?.length).toBe(2);
  });

  it("buildEpubBlob produces zip with mimetype", async () => {
    const { blob, base64, words } = await buildEpubBlob("测试书", [
      { id: "第1章", title: "开端", body: "正文一二三" },
    ]);
    expect(blob.size).toBeGreaterThan(100);
    expect(base64.length).toBeGreaterThan(50);
    expect(words).toBeGreaterThan(0);
    // PK zip magic in base64 of binary often starts with UEs
    expect(base64.startsWith("UEs")).toBe(true);
  });

  it("buildDocxBlob produces zip", async () => {
    const { base64 } = await buildDocxBlob("测试书", [
      { id: "第1章", title: "开端", body: "你好世界" },
    ]);
    expect(base64.startsWith("UEs")).toBe(true);
  });
});
