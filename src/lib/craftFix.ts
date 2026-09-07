/** 工艺病一键润色 prompt */

import { craftPolishAddon, craftUserChecklist } from "./craftRules";
import type { ScanHit } from "./scan";

export function craftFixPrompt(opts: {
  body: string;
  hits: ScanHit[];
  selection?: string;
}): string {
  const hitLines = (opts.hits || [])
    .filter((h) => h.kind === "工艺病" || h.kind === "禁忌词")
    .slice(0, 20)
    .map((h) => `- [${h.kind}] ${h.text}：${h.detail}`)
    .join("\n");
  const scope = opts.selection?.trim()
    ? `只改写下列选区，输出改写后的选区全文：\n${opts.selection.slice(0, 12000)}`
    : `输出润色后的完整正文 Markdown（保持情节与人称）：\n${opts.body.slice(0, 28000)}`;
  return `按写作工艺红线改写，消灭扫描到的问题。
${craftPolishAddon()}
${craftUserChecklist()}

扫描命中：
${hitLines || "（无明确命中，仍按红线通篇去病：啰嗦/重复/电报/顶真/标语口号/总结腔）"}

${scope}`;
}
