export type HotkeyAction =
  | "save"
  | "generate"
  | "next"
  | "prev"
  | "focus"
  | "search"
  | "bookSearch";

export type HotkeyMap = Record<HotkeyAction, string>;

export const DEFAULT_HOTKEYS: HotkeyMap = {
  save: "Control+S",
  generate: "Control+Enter",
  next: "Control+Shift+N",
  prev: "Control+Shift+P",
  focus: "F11",
  /** Studio 内：章内查找；其它页：书内搜索 */
  search: "Control+F",
  bookSearch: "Control+Shift+F",
};

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  save: "保存正文",
  generate: "生成/写本章",
  next: "下一章",
  prev: "上一章",
  focus: "专注模式",
  search: "查找（Studio）/ 书内搜索",
  bookSearch: "书内搜索",
};

export function normalizeHotkeyMap(raw?: Partial<HotkeyMap> | null): HotkeyMap {
  return { ...DEFAULT_HOTKEYS, ...(raw || {}) };
}

/** 把 KeyboardEvent 编成可比较字符串 */
export function eventToHotkey(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key;
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();
  if (key === "Control" || key === "Alt" || key === "Shift" || key === "Meta") {
    return parts.join("+");
  }
  parts.push(key === "\\" ? "\\" : key);
  return parts.join("+");
}

export function matchHotkey(
  e: {
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    key: string;
  },
  binding: string
): boolean {
  const want = binding.trim();
  if (!want) return false;
  return eventToHotkey(e).toLowerCase() === want.toLowerCase();
}
