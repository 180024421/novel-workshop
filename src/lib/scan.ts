export type ScanHit = {
  kind: "禁忌词" | "人名疑似漂移" | "细纲缺项";
  text: string;
  detail: string;
};

const DEFAULT_TABOO = [
  "总之",
  "总而言之",
  "不禁",
  "缓缓道",
  "嘴角微微上扬",
  "目光如炬",
  "杀气腾腾",
  "心中暗道",
  "仿佛在说",
];

export async function loadTabooList(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<string[]> {
  if (!window.moshu) return DEFAULT_TABOO;
  const raw = await window.moshu.readText(await join(root, "prompts", "taboo.md"));
  if (!raw.trim()) return DEFAULT_TABOO;
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function scanTaboo(body: string, taboo: string[]): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const w of taboo) {
    if (!w) continue;
    let idx = 0;
    let n = 0;
    while ((idx = body.indexOf(w, idx)) >= 0) {
      n++;
      idx += w.length;
    }
    if (n > 0) {
      hits.push({ kind: "禁忌词", text: w, detail: `出现 ${n} 次` });
    }
  }
  return hits;
}

/** 简单人名：取人物卡名，检查正文是否几乎不出现（可能写错名） */
export function scanNamePresence(body: string, names: string[]): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const name of names) {
    if (!name || name.length < 2) continue;
    if (!body.includes(name)) {
      hits.push({
        kind: "人名疑似漂移",
        text: name,
        detail: "人物卡中有此名，本章正文未出现（若本应出场请检查）",
      });
    }
  }
  return hits;
}

/** 细纲对照：检查正文是否覆盖细纲关键段 */
export function scanBeatsCoverage(body: string, beats: string): ScanHit[] {
  const hits: ScanHit[] = [];
  if (!beats.trim()) {
    hits.push({ kind: "细纲缺项", text: "细纲", detail: "本章没有细纲" });
    return hits;
  }
  const need = ["本章目标", "场次", "章末钩子", "必出场"];
  for (const k of need) {
    if (!beats.includes(k)) {
      hits.push({ kind: "细纲缺项", text: k, detail: `细纲缺少「${k}」段落` });
    }
  }
  // 从细纲抽「必出场人物」行里的短名，粗检
  const m = beats.match(/##\s*必出场人物([\s\S]*?)(?:##|$)/);
  if (m) {
    const names = m[1]
      .split(/[\n,，、]/)
      .map((x) => x.replace(/^[-*•\d.\s]+/, "").trim())
      .filter((x) => x.length >= 2 && x.length <= 6);
    for (const n of names.slice(0, 8)) {
      if (!body.includes(n)) {
        hits.push({
          kind: "细纲缺项",
          text: n,
          detail: `细纲必出场「${n}」在正文中未找到`,
        });
      }
    }
  }
  if (beats.includes("章末钩子") && body.replace(/\s+/g, "").length > 400) {
    const tail = body.slice(-400);
    if (tail.length < 80) {
      hits.push({ kind: "细纲缺项", text: "章末", detail: "正文过短，难以判断章末钩子" });
    }
  }
  return hits;
}

export async function runChapterScan(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  body: string;
  beats: string;
  characterNames: string[];
}): Promise<ScanHit[]> {
  const taboo = await loadTabooList(opts.root, opts.join);
  return [
    ...scanTaboo(opts.body, taboo),
    ...scanNamePresence(opts.body, opts.characterNames),
    ...scanBeatsCoverage(opts.body, opts.beats),
  ];
}
