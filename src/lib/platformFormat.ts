/** 平台排版：起点 / 番茄风格 */

export type PlatformFormatId = "qidian" | "tomato" | "plain";

export function formatForPlatform(body: string, platform: PlatformFormatId): string {
  let text = (body || "").replace(/\r\n/g, "\n").trim();
  // 去掉 markdown 标题行（导出正文时常不需要）
  text = text.replace(/^#\s*第\d+章[^\n]*\n+/m, "");
  if (platform === "plain") return text;

  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, "").trim())
    .filter(Boolean);

  if (platform === "qidian") {
    // 段间空一行；段首不加全角空格（起点后台常自处理）
    return paras.join("\n\n");
  }

  // tomato：段首全角空格×2 + 段间空行
  return paras.map((p) => (p.startsWith("　") ? p : `　　${p}`)).join("\n\n");
}

export function appendWordCountFooter(body: string, words: number): string {
  const t = body.trimEnd();
  if (/字数\s*[:：]?\s*\d+/.test(t.slice(-40))) return t;
  return `${t}\n\n（字数：${words}）`;
}

export function sanitizeExportFileName(name: string): string {
  return (name || "export").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}
