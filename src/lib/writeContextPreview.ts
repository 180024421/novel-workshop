/** 写章前上下文预览：可勾选注入块 */

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

export function toggleBlock(
  blocks: WriteContextBlock[],
  id: string,
  enabled: boolean
): WriteContextBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, enabled } : b));
}
