import { describe, expect, it } from "vitest";
import { buildMaterialLamps, firstMissingLamp, upstreamMaterials } from "./materialLamps";

const full = { bible: "设定文", outline: "总纲文", chapterBeats: "场次文" };

describe("materialLamps（Flow A 物料灯）", () => {
  it("idea 页无上游，状态条不渲染", () => {
    expect(upstreamMaterials("idea")).toEqual([]);
    expect(buildMaterialLamps("idea", full)).toEqual([]);
  });

  it("正文页三灯：细纲缺失 → 第一张补料卡是 beats/gen-beats", () => {
    const lamps = buildMaterialLamps("chapter", { ...full, chapterBeats: "   " });
    expect(lamps.map((l) => l.key)).toEqual(["setup", "outline", "beats"]);
    const missing = firstMissingLamp(lamps);
    expect(missing?.key).toBe("beats");
    expect(missing?.repairAction).toBe("gen-beats");
  });

  it("全部就绪 → firstMissingLamp 为 null（无阻断）", () => {
    expect(firstMissingLamp(buildMaterialLamps("chapter", full))).toBeNull();
  });

  it("总纲页只依赖设定；缺设定即 missing", () => {
    const lamps = buildMaterialLamps("outline", { ...full, bible: "" });
    expect(lamps).toHaveLength(1);
    expect(lamps[0]).toMatchObject({ key: "setup", status: "missing" });
  });
});
