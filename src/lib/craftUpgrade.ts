/** 旧书一键补齐工艺红线到 prompts/style.md + taboo.md */

import { CRAFT_STYLE_MD, CRAFT_TABOO_LINES } from "./craftRules";

export function mergeCraftStyle(existing: string): string {
  const cur = (existing || "").trim();
  if (/写作工艺（强制）|禁止（正文出现即判劣质）/.test(cur)) {
    // 已有工艺块：若缺少关键禁词标题则追加简短提醒
    if (/电报文|标语体|口号体/.test(cur)) return cur;
  }
  if (!cur) return CRAFT_STYLE_MD.trim() + "\n";
  return `${CRAFT_STYLE_MD.trim()}\n\n## 原有风格\n${cur}\n`;
}

export function mergeCraftTaboo(existing: string): string {
  const lines = (existing || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
    .filter((l) => l && !l.startsWith("#"));
  const set = new Set(lines);
  for (const w of CRAFT_TABOO_LINES) set.add(w);
  // keep some classic defaults
  for (const w of ["总之", "总而言之", "不禁", "目光如炬", "嘴角微微上扬", "杀气腾腾", "心中暗道"]) {
    set.add(w);
  }
  return [...set].map((w) => `- ${w}`).join("\n") + "\n";
}

export async function applyCraftUpgrade(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<{ stylePath: string; tabooPath: string }> {
  if (!window.moshu) throw new Error("需要桌面端");
  const stylePath = await join(root, "prompts", "style.md");
  const tabooPath = await join(root, "prompts", "taboo.md");
  const style = await window.moshu.readText(stylePath);
  const taboo = await window.moshu.readText(tabooPath);
  await window.moshu.writeText(stylePath, mergeCraftStyle(style));
  await window.moshu.writeText(tabooPath, mergeCraftTaboo(taboo));
  return { stylePath, tabooPath };
}
