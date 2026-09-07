import { describe, expect, it } from "vitest";
import {
  CRAFT_BAN_RULES,
  CRAFT_MUST_RULES,
  craftSystemAddon,
  craftUserChecklist,
} from "./craftRules";
import { scanCraftIssues } from "./scan";

describe("craftRules", () => {
  it("covers user-named bans", () => {
    const titles = CRAFT_BAN_RULES.map((r) => r.title);
    for (const t of ["啰嗦", "重复", "电报文", "顶真文", "标语体", "口号体"]) {
      expect(titles).toContain(t);
    }
    expect(CRAFT_MUST_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it("system addon mentions bans and musts", () => {
    const s = craftSystemAddon();
    expect(s).toMatch(/电报文|标语|口号/);
    expect(s).toMatch(/画面|张力/);
    expect(craftUserChecklist()).toMatch(/工艺自检/);
  });
});

describe("scanCraftIssues", () => {
  it("flags slogan-like lines", () => {
    const hits = scanCraftIssues("他握刀冷笑。\n这一刀，注定改写命运。\n刀光一闪。");
    expect(hits.some((h) => h.kind === "工艺病")).toBe(true);
  });

  it("flags heavy anadiplosis chain", () => {
    const body = "天下大乱。乱世出英雄。英雄末路。路在何方。";
    const hits = scanCraftIssues(body);
    expect(hits.some((h) => /顶真/.test(h.detail) || /顶真/.test(h.text))).toBe(true);
  });
});
