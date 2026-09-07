import type { StudioMode } from "../../lib/agentChatStore";
import type { VolumeEntry } from "../../lib/volumes";

export type { StudioMode };

export const NEXT_STEP: Record<
  StudioMode,
  { label: string; to: string; tip: string } | null
> = {
  idea: { label: "去写总纲", to: "/app/outline", tip: "设定就绪后，用总纲写全书梗概与分卷主题" },
  outline: { label: "去写细纲", to: "/app/beats", tip: "总纲就绪后，按卷写章节目录与场次" },
  beats: { label: "去写正文", to: "/app/chapter", tip: "细纲有章后，用「写本章」生成正文" },
  chapter: null,
};

export function modeFromPath(pathname: string): StudioMode {
  if (pathname.includes("/outline")) return "outline";
  if (pathname.includes("/beats")) return "beats";
  if (pathname.includes("/chapter")) return "chapter";
  return "idea";
}

export function modeLabel(mode: StudioMode) {
  if (mode === "idea") return "设定";
  if (mode === "outline") return "总纲";
  if (mode === "beats") return "细纲（按卷）";
  return "正文";
}

export const EMPTY_VOLUMES: VolumeEntry[] = [
  { id: "第1卷", title: "第1卷", chapters: [] },
];

export function extractMarkdownBlock(text: string): string | null {
  const m = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  return null;
}

export function stripFences(text: string) {
  const inner = extractMarkdownBlock(text);
  return inner ?? text.trim();
}

export type EditScope = {
  kind: "selection" | "document";
  start: number;
  end: number;
  text: string;
  label: string;
};
