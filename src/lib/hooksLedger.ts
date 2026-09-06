import { chatCompletion } from "./gateway";
import type { AppSettings } from "../types";
import type { ProviderConfig } from "./providerPresets";
import { SYSTEM_WRITER } from "./prompts";

export type HookItem = {
  id: string;
  fromChapter: string;
  text: string;
  kind: "钩子" | "伏笔" | "人物" | "其他";
  status: "open" | "resolved";
  createdAt: string;
};

export type HooksLedger = {
  items: HookItem[];
  updatedAt: string;
};

export function extractHooksPrompt(chapterId: string, body: string) {
  return `从本章正文末尾与全文抽出「未解钩子 / 伏笔 / 新出场人物」。
只输出 JSON 数组（不要代码围栏）：
[{"kind":"钩子|伏笔|人物|其他","text":"一句话"}]

本章：${chapterId}
正文：
${body.slice(0, 10000)}`;
}

export function parseHooksJson(raw: string, fromChapter: string): HookItem[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1)) as { kind?: string; text?: string }[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x?.text?.trim())
      .map((x, i) => {
        const k = String(x.kind || "钩子");
        const kind =
          k.includes("伏") ? "伏笔" : k.includes("人") ? "人物" : k.includes("其") ? "其他" : "钩子";
        return {
          id: `hook_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          fromChapter,
          text: String(x.text).trim(),
          kind: kind as HookItem["kind"],
          status: "open" as const,
          createdAt: new Date().toISOString(),
        };
      });
  } catch {
    return [];
  }
}

export async function loadHooksLedger(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<HooksLedger> {
  if (!window.moshu) return { items: [], updatedAt: "" };
  return window.moshu.readJson<HooksLedger>(await join(root, "continuity", "hooks.json"), {
    items: [],
    updatedAt: "",
  });
}

export async function saveHooksLedger(
  root: string,
  join: (...p: string[]) => Promise<string>,
  ledger: HooksLedger
) {
  if (!window.moshu) return;
  await window.moshu.writeJson(await join(root, "continuity", "hooks.json"), {
    ...ledger,
    updatedAt: new Date().toISOString(),
  });
}

/** 合并本章新钩子；同章旧 open 项可替换 */
export async function mergeChapterHooks(
  root: string,
  join: (...p: string[]) => Promise<string>,
  fromChapter: string,
  news: HookItem[]
) {
  const ledger = await loadHooksLedger(root, join);
  const kept = ledger.items.filter(
    (h) => !(h.fromChapter === fromChapter && h.status === "open")
  );
  await saveHooksLedger(root, join, { items: [...kept, ...news], updatedAt: "" });
}

export async function setHookStatus(
  root: string,
  join: (...p: string[]) => Promise<string>,
  hookId: string,
  status: "open" | "resolved"
) {
  const ledger = await loadHooksLedger(root, join);
  const items = ledger.items.map((h) => (h.id === hookId ? { ...h, status } : h));
  await saveHooksLedger(root, join, { items, updatedAt: "" });
}

export async function resolveHook(
  root: string,
  join: (...p: string[]) => Promise<string>,
  hookId: string
) {
  return setHookStatus(root, join, hookId, "resolved");
}

export async function reopenHook(
  root: string,
  join: (...p: string[]) => Promise<string>,
  hookId: string
) {
  return setHookStatus(root, join, hookId, "open");
}

export async function resolveMany(
  root: string,
  join: (...p: string[]) => Promise<string>,
  hookIds: string[]
) {
  const set = new Set(hookIds);
  const ledger = await loadHooksLedger(root, join);
  const items = ledger.items.map((h) =>
    set.has(h.id) ? { ...h, status: "resolved" as const } : h
  );
  await saveHooksLedger(root, join, { items, updatedAt: "" });
}

/** 将早于本章的 open 钩子标为已推进（用户确认后） */
export async function resolveHooksBeforeChapter(
  root: string,
  join: (...p: string[]) => Promise<string>,
  chapterId: string
) {
  const n = Number(chapterId.match(/\d+/)?.[0] || 0);
  const ledger = await loadHooksLedger(root, join);
  const items = ledger.items.map((h) => {
    const hn = Number(h.fromChapter.match(/\d+/)?.[0] || 0);
    if (h.status === "open" && hn > 0 && hn < n) {
      return { ...h, status: "resolved" as const };
    }
    return h;
  });
  await saveHooksLedger(root, join, { items, updatedAt: "" });
}

export function formatOpenHooksForPrompt(ledger: HooksLedger, limit = 12): string {
  const open = ledger.items.filter((h) => h.status === "open").slice(-limit);
  if (!open.length) return "";
  return (
    "上章/前文未解钩子与伏笔（本章应有呼应或推进，勿无故遗忘）：\n" +
    open.map((h, i) => `${i + 1}. [${h.kind}/${h.fromChapter}] ${h.text}`).join("\n")
  );
}

export async function extractAndSaveHooks(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  chapterId: string;
  body: string;
  settings: AppSettings;
  providers: ProviderConfig[];
  signal?: AbortSignal;
}) {
  const raw = await chatCompletion(
    opts.settings,
    [
      { role: "system", content: SYSTEM_WRITER },
      { role: "user", content: extractHooksPrompt(opts.chapterId, opts.body) },
    ],
    { model: opts.settings.routeCheck || "复杂", providers: opts.providers, stream: false, signal: opts.signal }
  );
  const news = parseHooksJson(raw, opts.chapterId);
  if (news.length) await mergeChapterHooks(opts.root, opts.join, opts.chapterId, news);
  return news;
}
