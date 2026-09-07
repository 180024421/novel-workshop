/** 今日写作字数 / 费用粗估（存 userData/usage.json） */

export type DayUsage = {
  words: number;
  costCny: number;
  /** 写章/批量成功次数（可选） */
  writeOk?: number;
  /** 写章/批量失败次数（可选） */
  writeFail?: number;
};

export type UsageStore = {
  days: Record<string, DayUsage>;
};

export type WeeklyReport = {
  from: string;
  to: string;
  words: number;
  costCny: number;
  writeOk: number;
  writeFail: number;
  failRate: number;
  activeDays: number;
  daily: { date: string; words: number; costCny: number; writeOk: number; writeFail: number }[];
};

function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyDay(): DayUsage {
  return { words: 0, costCny: 0, writeOk: 0, writeFail: 0 };
}

/** 本地周报：近 N 天字数 / 费用 / 失败率 */
export function buildWeeklyReport(
  store: UsageStore,
  days = 7,
  now = new Date()
): WeeklyReport {
  const daily: WeeklyReport["daily"] = [];
  let words = 0;
  let costCny = 0;
  let writeOk = 0;
  let writeFail = 0;
  let activeDays = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = todayKey(d);
    const cur = store.days[key] || emptyDay();
    const ok = cur.writeOk || 0;
    const fail = cur.writeFail || 0;
    daily.push({
      date: key,
      words: cur.words || 0,
      costCny: cur.costCny || 0,
      writeOk: ok,
      writeFail: fail,
    });
    words += cur.words || 0;
    costCny += cur.costCny || 0;
    writeOk += ok;
    writeFail += fail;
    if ((cur.words || 0) > 0 || ok > 0 || fail > 0) activeDays += 1;
  }
  const attempts = writeOk + writeFail;
  return {
    from: daily[0]?.date || todayKey(now),
    to: daily[daily.length - 1]?.date || todayKey(now),
    words,
    costCny,
    writeOk,
    writeFail,
    failRate: attempts ? Math.round((writeFail / attempts) * 1000) / 10 : 0,
    activeDays,
    daily,
  };
}

/** 连续写作天数：自今天（若今日为 0 则自昨天）向前数有字日 */
export function calcWritingStreak(
  days: Record<string, DayUsage>,
  now = new Date()
): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = days[todayKey(d)];
  if (!today || today.words <= 0) {
    d.setDate(d.getDate() - 1);
  }
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const cur = days[todayKey(d)];
    if (!cur || cur.words <= 0) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
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

export async function addUsage(delta: {
  words?: number;
  costCny?: number;
  writeOk?: number;
  writeFail?: number;
}): Promise<DayUsage> {
  const words = Math.max(0, Math.round(delta.words || 0));
  const costCny = Math.max(0, Number(delta.costCny) || 0);
  const writeOk = Math.max(0, Math.round(delta.writeOk || 0));
  const writeFail = Math.max(0, Math.round(delta.writeFail || 0));
  if (window.moshu?.addUsage) {
    return window.moshu.addUsage({ words, costCny, writeOk, writeFail });
  }
  const store = await loadUsage();
  const key = todayKey();
  const cur = store.days[key] || emptyDay();
  const next: DayUsage = {
    words: cur.words + words,
    costCny: cur.costCny + costCny,
    writeOk: (cur.writeOk || 0) + writeOk,
    writeFail: (cur.writeFail || 0) + writeFail,
  };
  store.days[key] = next;
  localStorage.setItem("moshu.usage", JSON.stringify(store));
  return next;
}

export function goalProgress(words: number, goal: number): number {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.round((words / goal) * 100));
}
