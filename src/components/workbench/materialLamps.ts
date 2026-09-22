import type { MaterialKey, MaterialLamp } from "./types";
import type { StudioMode } from "../../lib/agentChatStore";

/**
 * Flow A「写作主循环工作台」的物料推导（纯函数，可单测）。
 * 数据全部来自 useStudioDocument 的现有字段，不新增状态源。
 */

export type MaterialSources = {
  /** 设定 bible.md */
  bible: string;
  /** 总纲 outline.md */
  outline: string;
  /** 本章细纲（当前章命中的 beats 段落） */
  chapterBeats: string;
};

const LABELS: Record<MaterialKey, string> = {
  setup: "设定",
  outline: "总纲",
  beats: "本章细纲",
};

/** 各阶段页依赖的上游物料（idea 页无上游） */
export function upstreamMaterials(mode: StudioMode): MaterialKey[] {
  switch (mode) {
    case "idea":
      return [];
    case "outline":
      return ["setup"];
    case "beats":
      return ["setup", "outline"];
    case "chapter":
      return ["setup", "outline", "beats"];
  }
}

function textOf(key: MaterialKey, src: MaterialSources): string {
  if (key === "setup") return src.bible;
  if (key === "outline") return src.outline;
  return src.chapterBeats;
}

export function buildMaterialLamps(
  mode: StudioMode,
  src: MaterialSources
): MaterialLamp[] {
  return upstreamMaterials(mode).map((key) => ({
    key,
    label: LABELS[key],
    status: textOf(key, src).trim() ? "ready" : "missing",
    repairAction:
      key === "setup" ? "gen-setup" : key === "outline" ? "gen-outline" : "gen-beats",
  }));
}

/** 第一个未就绪的物料（决定内联补料卡展示哪张）；全绿返回 null */
export function firstMissingLamp(lamps: MaterialLamp[]): MaterialLamp | null {
  return lamps.find((l) => l.status !== "ready") ?? null;
}
