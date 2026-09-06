import type { CharacterCard } from "../types";

export function characterToMarkdown(c: CharacterCard) {
  return `# ${c.name || "未命名"}

- 身份：${c.role}
- 声口：${c.voice}
- 性格：${c.traits}
- 关系：${c.relationships}
- 禁忌：${c.taboo}
- 弧线：${c.arc}
`;
}

export async function loadCharactersMarkdown(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<string> {
  if (!window.moshu) return "";
  const files = await window.moshu.listDir(await join(root, "characters"));
  const mdFiles = files.filter((f) => f.name.endsWith(".md"));
  if (!mdFiles.length) return "";
  const parts = await Promise.all(mdFiles.map((f) => window.moshu!.readText(f.path)));
  return parts.filter(Boolean).join("\n\n");
}

export async function saveCharacterCards(
  root: string,
  join: (...p: string[]) => Promise<string>,
  cards: CharacterCard[]
) {
  if (!window.moshu) return;
  for (const card of cards) {
    if (!card.name?.trim()) continue;
    const base = card.name.trim().replace(/[<>:"/\\|?*]/g, "_");
    const full: CharacterCard = {
      id: card.id || `char_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: card.name.trim(),
      role: card.role || "",
      voice: card.voice || "",
      traits: card.traits || "",
      relationships: card.relationships || "",
      taboo: card.taboo || "",
      arc: card.arc || "",
    };
    await window.moshu.writeJson(await join(root, "characters", `${base}.json`), full);
    await window.moshu.writeText(
      await join(root, "characters", `${base}.md`),
      characterToMarkdown(full)
    );
  }
}

/** 解析模型输出的人物 JSON */
export function parseCharactersJson(raw: string): CharacterCard[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1)) as Partial<CharacterCard>[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === "object" && String(x.name || "").trim())
      .map((x, i) => ({
        id: x.id || `char_${Date.now()}_${i}`,
        name: String(x.name || "").trim(),
        role: String(x.role || ""),
        voice: String(x.voice || ""),
        traits: String(x.traits || ""),
        relationships: String(x.relationships || ""),
        taboo: String(x.taboo || ""),
        arc: String(x.arc || ""),
      }));
  } catch {
    return [];
  }
}
