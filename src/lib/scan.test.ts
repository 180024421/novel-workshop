import { describe, expect, it } from "vitest";
import {
  expectedNamesFromBeats,
  scanNamePresence,
  scanNameShortAlias,
} from "./scan";

describe("scan names", () => {
  it("expectedNamesFromBeats intersects card names mentioned in beats", () => {
    const beats = "## 必出场人物\n- 李云龙\n- 赵刚\n\n场次里林辰说话。";
    const cards = ["李云龙", "赵刚", "楚云飞", "林辰"];
    const exp = expectedNamesFromBeats(beats, cards);
    expect(exp).toContain("李云龙");
    expect(exp).toContain("赵刚");
    expect(exp).toContain("林辰");
    expect(exp).not.toContain("楚云飞");
  });

  it("scanNamePresence only flags missing expected names", () => {
    const body = "李云龙一枪撂倒鬼子。";
    const hits = scanNamePresence(body, ["李云龙", "赵刚"]);
    expect(hits.map((h) => h.text)).toEqual(["赵刚"]);
  });

  it("scanNameShortAlias warns when only suffix appears", () => {
    const body = "云龙骂骂咧咧走了。";
    const hits = scanNameShortAlias(body, ["李云龙"]);
    expect(hits.length).toBe(1);
    expect(hits[0].detail).toMatch(/简称|后缀/);
  });
});
