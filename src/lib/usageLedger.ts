/** 今日写作字数 / 费用粗估（存 userData/usage.json） */

export type DayUsage = {
  words: number;
  costCny: number;
};

export type UsageStore = {
  days: Record<string, DayUsage>;
};

function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyDay(): DayUsage {
  return { words: 0, costCny: 0 };
}

export async function loadUsage(): Promise<UsageStore> {
  if (window.moshu?.getUsage) {
    return window.moshu.getUsage();
  }
  try {
    const raw = localStorage.getItem("moshu.usage");
    if (raw) return JSON.parse(raw) as UsageStore;
  } catch {
    /* ignore */
  }
  return { days: {} };
}

export async function getTodayUsage(): Promise<DayUsage> {
  const store = await loadUsage();
  return store.days[todayKey()] || emptyDay();
}

export async function getRecentUsage(
  days = 7
): Promise<{ date: string; words: number; costCny: number }[]> {
  const store = await loadUsage();
  const out: { date: string; words: number; costCny: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = todayKey(d);
    const cur = store.days[key] || emptyDay();
    out.push({ date: key.slice(5), words: cur.words, costCny: cur.costCny });
  }
  return out;
}

export async function addUsage(delta: { words?: number; costCny?: number }): Promise<DayUsage> {
  const words = Math.max(0, Math.round(delta.words || 0));
  const costCny = Math.max(0, Number(delta.costCny) || 0);
  if (window.moshu?.addUsage) {
    return window.moshu.addUsage({ words, costCny });
  }
  const store = await loadUsage();
  const key = todayKey();
  const cur = store.days[key] || emptyDay();
  const next = {
    words: cur.words + words,
    costCny: cur.costCny + costCny,
  };
  store.days[key] = next;
  localStorage.setItem("moshu.usage", JSON.stringify(store));
  return next;
}

export function goalProgress(words: number, goal: number): number {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.round((words / goal) * 100));
}
