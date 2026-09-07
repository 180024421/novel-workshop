/** 世界观实体卡：地点 / 势力 / 器物 / 术语 */

export type EntityKind = "地点" | "势力" | "器物" | "术语" | "其他";

export type EntityCard = {
  id: string;
  name: string;
  kind: EntityKind;
  aliases: string;
  description: string;
  taboo: string;
};

export function emptyEntity(): EntityCard {
  return {
    id: `ent_${Date.now()}`,
    name: "",
    kind: "其他",
    aliases: "",
    description: "",
    taboo: "",
  };
}

export function entityFileBase(e: EntityCard) {
  return (e.name || e.id).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
}

export async function loadEntities(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<EntityCard[]> {
  if (!window.moshu) return [];
  const dir = await join(root, "entities");
  let files: { name: string; path: string }[] = [];
  try {
    files = await window.moshu.listDir(dir);
  } catch {
    return [];
  }
  const out: EntityCard[] = [];
  for (const f of files) {
    if (!f.name.endsWith(".json")) continue;
    const c = await window.moshu.readJson<EntityCard | null>(f.path, null);
    if (c?.name) out.push(c);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

export async function saveEntity(
  root: string,
  join: (...p: string[]) => Promise<string>,
  card: EntityCard
) {
  if (!window.moshu) return;
  const base = entityFileBase(card);
  await window.moshu.writeJson(await join(root, "entities", `${base}.json`), card);
}

export async function deleteEntity(
  root: string,
  join: (...p: string[]) => Promise<string>,
  card: EntityCard
) {
  if (!window.moshu?.deletePath) return;
  const base = entityFileBase(card);
  await window.moshu.deletePath(await join(root, "entities", `${base}.json`));
}

/** 从细纲+正文查询里命中实体名/别名 */
export function matchEntities(query: string, entities: EntityCard[], limit = 8): EntityCard[] {
  const q = query || "";
  if (!q.trim() || !entities.length) return [];
  const hits: EntityCard[] = [];
  for (const e of entities) {
    if (!e.name) continue;
    if (q.includes(e.name)) {
      hits.push(e);
      continue;
    }
    const aliases = (e.aliases || "")
      .split(/[,，、;；]/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);
    if (aliases.some((a) => q.includes(a))) hits.push(e);
    if (hits.length >= limit) break;
  }
  return hits;
}

export function formatEntitiesForPrompt(entities: EntityCard[]): string {
  if (!entities.length) return "";
  return [
    "【设定实体｜名称与禁忌须一致，禁止擅自改设定】",
    ...entities.map((e) => {
      const alias = e.aliases.trim() ? `（别名：${e.aliases}）` : "";
      const taboo = e.taboo.trim() ? `；禁忌：${e.taboo}` : "";
      return `- [${e.kind}] ${e.name}${alias}：${e.description.slice(0, 200)}${taboo}`;
    }),
  ].join("\n");
}
