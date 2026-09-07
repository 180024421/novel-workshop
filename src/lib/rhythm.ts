import { loadHooksLedger } from "./hooksLedger";
import { countTextWords, type ProjectProgress } from "./projectProgress";

export type RhythmStats = {
  openHooks: number;
  resolvedHooks: number;
  hookCloseRatio: number;
  chaptersDone: number;
  avgWords: number;
  wordBuckets: { label: string; count: number }[];
  tagCounts: { tag: string; count: number }[];
};

const TAG_RULES: { tag: string; re: RegExp }[] = [
  { tag: "战斗", re: /打|战|杀|刀|枪|拳|炮|伏击|突围/ },
  { tag: "日常", re: /吃|睡|聊|笑|走|村|家|饭|酒/ },
  { tag: "感情", re: /爱|吻|情|心|泪|抱/ },
  { tag: "谋略", re: /计|谋|情报|布局|算计|卧底/ },
];

export function bucketWords(words: number): string {
  if (words < 1500) return "<1500";
  if (words < 2500) return "1500-2500";
  if (words < 3500) return "2500-3500";
  return "≥3500";
}

export async function computeRhythmStats(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  prog: ProjectProgress | null;
  sampleBodies?: { chapterId: string; body: string }[];
}): Promise<RhythmStats> {
  const ledger = await loadHooksLedger(opts.root, opts.join);
  const openHooks = ledger.items.filter((h) => h.status === "open").length;
  const resolvedHooks = ledger.items.filter((h) => h.status === "resolved").length;
  const totalH = openHooks + resolvedHooks;
  const done = opts.prog?.chapterRows.filter((r) => r.hasChapter && r.words > 0) || [];
  const avgWords = done.length
    ? Math.round(done.reduce((s, r) => s + r.words, 0) / done.length)
    : 0;
  const bucketMap = new Map<string, number>();
  for (const r of done) {
    const b = bucketWords(r.words);
    bucketMap.set(b, (bucketMap.get(b) || 0) + 1);
  }
  const wordBuckets = ["<1500", "1500-2500", "2500-3500", "≥3500"].map((label) => ({
    label,
    count: bucketMap.get(label) || 0,
  }));

  const tagCounts = TAG_RULES.map((t) => ({ tag: t.tag, count: 0 }));
  for (const s of opts.sampleBodies || []) {
    for (let i = 0; i < TAG_RULES.length; i++) {
      if (TAG_RULES[i].re.test(s.body)) tagCounts[i].count++;
    }
  }

  return {
    openHooks,
    resolvedHooks,
    hookCloseRatio: totalH ? resolvedHooks / totalH : 0,
    chaptersDone: done.length,
    avgWords,
    wordBuckets,
    tagCounts,
  };
}

export { countTextWords };
