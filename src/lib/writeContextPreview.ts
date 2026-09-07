/** 写章前上下文预览：可勾选注入块（显式 contextBlocks，不再只靠备注） */

export type WriteContextBlockKind = "summary" | "entity" | "hooks" | "kb" | "style";

export type WriteContextBlock = {
  id: string;
  kind: WriteContextBlockKind;
  title: string;
  text: string;
  enabled: boolean;
};

export function assembleContextFromBlocks(blocks: WriteContextBlock[]): string {
  return blocks
    .filter((b) => b.enabled && b.text.trim())
    .map((b) => `【${b.title}】\n${b.text.trim()}`)
    .join("\n\n");
}

/** 写入写章 prompt 的显式块标题 */
export function formatContextBlocksForPrompt(assembled: string): string {
  const t = (assembled || "").trim();
  if (!t) return "";
  return `## 上下文块（contextBlocks）\n${t}`;
}

export function toggleBlock(
  blocks: WriteContextBlock[],
  id: string,
  enabled: boolean
): WriteContextBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, enabled } : b));
}
