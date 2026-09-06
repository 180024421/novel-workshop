import type { AppSettings } from "../types";

export type EditorThemeId =
  | "ink"
  | "paper"
  | "sepia"
  | "slate"
  | "midnight"
  | "forest"
  | "ocean"
  | "rose"
  | "graphite";

export type ThemePreset = {
  label: string;
  tone: "dark" | "light";
  bg: string;
  fg: string;
  muted: string;
  panel: string;
  agentBg: string;
  agentInputBg: string;
  agentInputFg: string;
  line: string;
  /** 左侧导航栏成套色 */
  sidebarBg: string;
  sidebarFg: string;
  sidebarMuted: string;
};

/** 成套配色：编辑器 / Agent / 侧栏一起变 */
export const EDITOR_THEME_PRESETS: Record<EditorThemeId, ThemePreset> = {
  ink: {
    label: "墨黑",
    tone: "dark",
    bg: "#000000",
    fg: "#ffffff",
    muted: "#c8c8c8",
    panel: "#0d0d0d",
    agentBg: "#0a0a0a",
    agentInputBg: "#1a1a1a",
    agentInputFg: "#ffffff",
    line: "rgba(255,255,255,0.14)",
    sidebarBg: "#0a0a0a",
    sidebarFg: "#ffffff",
    sidebarMuted: "#d0d0d0",
  },
  paper: {
    label: "纸白",
    tone: "light",
    bg: "#faf8f4",
    fg: "#111111",
    muted: "#5c564e",
    panel: "#f0ebe3",
    agentBg: "#f3efe6",
    agentInputBg: "#ffffff",
    agentInputFg: "#111111",
    line: "rgba(0,0,0,0.14)",
    sidebarBg: "#f0ebe3",
    sidebarFg: "#111111",
    sidebarMuted: "#4a453e",
  },
  sepia: {
    label: "护眼米黄",
    tone: "light",
    bg: "#f3e6c8",
    fg: "#2a1f10",
    muted: "#6e5a3e",
    panel: "#e8d7b0",
    agentBg: "#ebe0c8",
    agentInputBg: "#faf3e4",
    agentInputFg: "#2a1f10",
    line: "rgba(60,40,10,0.18)",
    sidebarBg: "#e8d7b0",
    sidebarFg: "#2a1f10",
    sidebarMuted: "#5a4528",
  },
  slate: {
    label: "石板灰",
    tone: "dark",
    bg: "#1e1e1e",
    fg: "#e8e8e8",
    muted: "#b8b8b8",
    panel: "#252526",
    agentBg: "#181818",
    agentInputBg: "#2d2d2d",
    agentInputFg: "#f0f0f0",
    line: "rgba(255,255,255,0.12)",
    sidebarBg: "#181818",
    sidebarFg: "#f0f0f0",
    sidebarMuted: "#c4c4c4",
  },
  midnight: {
    label: "午夜蓝",
    tone: "dark",
    bg: "#0b1220",
    fg: "#e8eef8",
    muted: "#a8bcd8",
    panel: "#121a2b",
    agentBg: "#0a101c",
    agentInputBg: "#152038",
    agentInputFg: "#e8eef8",
    line: "rgba(160,190,255,0.16)",
    sidebarBg: "#0a101c",
    sidebarFg: "#e8eef8",
    sidebarMuted: "#b0c4e0",
  },
  forest: {
    label: "墨绿",
    tone: "dark",
    bg: "#0f1a14",
    fg: "#e6f2ea",
    muted: "#a0c4ae",
    panel: "#15241c",
    agentBg: "#0c1611",
    agentInputBg: "#1a2e22",
    agentInputFg: "#e6f2ea",
    line: "rgba(140,200,160,0.16)",
    sidebarBg: "#0c1611",
    sidebarFg: "#e6f2ea",
    sidebarMuted: "#b0d0bc",
  },
  ocean: {
    label: "海蓝",
    tone: "dark",
    bg: "#071820",
    fg: "#dff3fa",
    muted: "#9ed0de",
    panel: "#0d2430",
    agentBg: "#06141c",
    agentInputBg: "#123040",
    agentInputFg: "#dff3fa",
    line: "rgba(120,200,230,0.16)",
    sidebarBg: "#06141c",
    sidebarFg: "#dff3fa",
    sidebarMuted: "#a8d8e6",
  },
  rose: {
    label: "胭脂浅",
    tone: "light",
    bg: "#fff5f5",
    fg: "#2a1218",
    muted: "#8a5a66",
    panel: "#f8e8ea",
    agentBg: "#fceedf",
    agentInputBg: "#ffffff",
    agentInputFg: "#2a1218",
    line: "rgba(80,30,40,0.14)",
    sidebarBg: "#f8e8ea",
    sidebarFg: "#2a1218",
    sidebarMuted: "#6a3844",
  },
  graphite: {
    label: "石墨",
    tone: "dark",
    bg: "#121212",
    fg: "#f5f5f5",
    muted: "#b8b8b8",
    panel: "#1c1c1c",
    agentBg: "#101010",
    agentInputBg: "#222222",
    agentInputFg: "#f5f5f5",
    line: "rgba(255,255,255,0.12)",
    sidebarBg: "#101010",
    sidebarFg: "#f5f5f5",
    sidebarMuted: "#c8c8c8",
  },
};

export const EDITOR_THEME_IDS = Object.keys(EDITOR_THEME_PRESETS) as EditorThemeId[];

export function isEditorThemeId(v: unknown): v is EditorThemeId {
  return typeof v === "string" && v in EDITOR_THEME_PRESETS;
}

export function resolveEditorColors(
  settings: Pick<AppSettings, "editorTheme" | "editorBgColor" | "editorFgColor">
) {
  const theme: EditorThemeId = isEditorThemeId(settings.editorTheme)
    ? settings.editorTheme
    : "ink";
  const preset = EDITOR_THEME_PRESETS[theme];
  const customBg = (settings.editorBgColor || "").trim();
  const customFg = (settings.editorFgColor || "").trim();
  return {
    theme,
    preset,
    bg: customBg || preset.bg,
    fg: customFg || preset.fg,
    usingCustom: Boolean(customBg || customFg),
  };
}

export function resolveSidebarColors(
  settings: Pick<
    AppSettings,
    "editorTheme" | "sidebarBgColor" | "sidebarFgColor" | "sidebarMutedColor"
  >
) {
  const theme: EditorThemeId = isEditorThemeId(settings.editorTheme)
    ? settings.editorTheme
    : "ink";
  const preset = EDITOR_THEME_PRESETS[theme];
  return {
    theme,
    preset,
    bg: (settings.sidebarBgColor || "").trim() || preset.sidebarBg,
    fg: (settings.sidebarFgColor || "").trim() || preset.sidebarFg,
    muted: (settings.sidebarMutedColor || "").trim() || preset.sidebarMuted,
  };
}

/** 选用成套主题：编辑区 + 侧栏一起写入 */
export function themePresetPatch(theme: EditorThemeId): Partial<AppSettings> {
  const p = EDITOR_THEME_PRESETS[theme];
  return {
    editorTheme: theme,
    editorBgColor: p.bg,
    editorFgColor: p.fg,
    sidebarBgColor: p.sidebarBg,
    sidebarFgColor: p.sidebarFg,
    sidebarMutedColor: p.sidebarMuted,
  };
}

export function sidebarPresetPatch(theme: EditorThemeId): Partial<AppSettings> {
  const p = EDITOR_THEME_PRESETS[theme];
  return {
    sidebarBgColor: p.sidebarBg,
    sidebarFgColor: p.sidebarFg,
    sidebarMutedColor: p.sidebarMuted,
  };
}

/** 把成套外观写到 :root */
export function applyEditorAppearance(settings: AppSettings) {
  const root = document.documentElement;
  const { theme, preset, bg, fg } = resolveEditorColors(settings);
  const side = resolveSidebarColors(settings);
  const fontSize = Math.min(36, Math.max(12, settings.editorFontSize || 16));
  const lineHeight = Math.min(2.4, Math.max(1.4, settings.editorLineHeight || 1.75));
  const sideFont = Math.min(18, Math.max(11, settings.sidebarFontSize || 13));

  root.dataset.editorTheme = theme;
  root.dataset.editorTone = preset.tone;

  root.style.setProperty("--editor-bg", bg);
  root.style.setProperty("--editor-fg", fg);
  root.style.setProperty("--editor-font-size", `${fontSize}px`);
  root.style.setProperty("--editor-lh", String(lineHeight));

  root.style.setProperty("--text", fg);
  root.style.setProperty("--muted", preset.muted);
  root.style.setProperty("--bg", preset.tone === "light" ? preset.panel : preset.bg);
  root.style.setProperty("--bg-elev", preset.panel);
  root.style.setProperty("--bg-panel", preset.panel);
  root.style.setProperty("--bg-soft", preset.agentBg);
  root.style.setProperty("--line", preset.line);
  root.style.setProperty(
    "--line-strong",
    preset.tone === "light" ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.28)"
  );

  root.style.setProperty("--agent-bg", preset.agentBg);
  root.style.setProperty("--agent-fg", preset.agentInputFg);
  root.style.setProperty("--agent-muted", preset.muted);
  root.style.setProperty("--agent-input-bg", preset.agentInputBg);
  root.style.setProperty("--agent-input-fg", preset.agentInputFg);
  root.style.setProperty("--agent-msg-bg", preset.tone === "light" ? "#ffffff" : "#161616");
  root.style.setProperty(
    "--agent-msg-user-bg",
    preset.tone === "light" ? "#fff8e8" : "rgba(255,255,255,0.06)"
  );

  root.style.setProperty("--sidebar-bg", side.bg);
  root.style.setProperty("--sidebar-fg", side.fg);
  root.style.setProperty("--sidebar-muted", side.muted);
  root.style.setProperty("--sidebar-font-size", `${sideFont}px`);
  root.style.setProperty(
    "--sidebar-active-bg",
    preset.tone === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.12)"
  );
  root.style.setProperty(
    "--sidebar-hover-bg",
    preset.tone === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)"
  );

  root.style.setProperty("--card-bg", preset.panel);
  root.style.setProperty("--input-bg", preset.agentInputBg);
  root.style.setProperty("--input-fg", preset.agentInputFg);

  if (document.body) {
    document.body.style.backgroundColor = root.style.getPropertyValue("--bg") || preset.bg;
    document.body.style.color = fg;
  }
}
