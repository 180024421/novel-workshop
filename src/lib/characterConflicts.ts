import type { CharacterCard } from "../types";

export type CharacterConflict = {
  level: "warn" | "error";
  message: string;
  names: string[];
};

/** 抽取/保存后的人物冲突检查 */
export function findCharacterConflicts(
  existing: CharacterCard[],
  incoming: CharacterCard[]
): CharacterConflict[] {
  const out: CharacterConflict[] = [];
  const byName = new Map<string, CharacterCard>();
  for (const c of existing) {
    const n = (c.name || "").trim();
    if (n) byName.set(n, c);
  }

  const seen = new Set<string>();
  for (const c of incoming) {
    const name = (c.name || "").trim();
    if (!name) {
      out.push({ level: "warn", message: "存在未命名人物卡", names: [] });
      continue;
    }
    if (seen.has(name)) {
      out.push({ level: "error", message: `新抽取结果内重名：${name}`, names: [name] });
    }
    seen.add(name);

    const old = byName.get(name);
    if (old) {
      const changed: string[] = [];
      if ((old.role || "") !== (c.role || "")) changed.push("身份");
      if ((old.voice || "") !== (c.voice || "")) changed.push("声口");
      if ((old.traits || "") !== (c.traits || "")) changed.push("性格");
      if (changed.length) {
        out.push({
          level: "warn",
          message: `「${name}」将覆盖已有卡（${changed.join("、")}有变化）`,
          names: [name],
        });
      } else {
        out.push({
          level: "warn",
          message: `「${name}」已存在，将覆盖同名卡`,
          names: [name],
        });
      }
    }

    if (!c.role?.trim()) {
      out.push({ level: "warn", message: `「${name}」身份为空`, names: [name] });
    }
  }

  // 近似重名：差一字
  const names = [...seen];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (similarName(names[i], names[j])) {
        out.push({
          level: "warn",
          message: `疑似同人异名：${names[i]} / ${names[j]}`,
          names: [names[i], names[j]],
        });
      }
    }
  }

  return out;
}

function similarName(a: string, b: string): boolean {
  if (a === b) return false;
  if (a.includes(b) || b.includes(a)) return Math.abs(a.length - b.length) <= 2;
  if (a.length < 2 || b.length < 2) return false;
  let diff = 0;
  const max = Math.max(a.length, b.length);
  const min = Math.min(a.length, b.length);
  if (max - min > 1) return false;
  for (let i = 0; i < min; i++) {
    if (a[i] !== b[i]) diff++;
    if (diff > 1) return false;
  }
  return diff === 1 || max !== min;
}
