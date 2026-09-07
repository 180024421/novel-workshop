import { CRAFT_TABOO_LINES } from "./craftRules";

export type ScanHit = {
  kind: "禁忌词" | "人名疑似漂移" | "细纲缺项" | "工艺病";
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
  ...CRAFT_TABOO_LINES,
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

/**
 * 从细纲中找出「应当出场」的人物卡名（细纲文本包含该姓名）。
 * 避免对未出场配角误报。
 */
export function expectedNamesFromBeats(beats: string, cardNames: string[]): string[] {
  const text = beats || "";
  if (!text.trim()) return [];
  const out: string[] = [];
  for (const name of cardNames) {
    const n = (name || "").trim();
    if (n.length < 2) continue;
    if (text.includes(n)) out.push(n);
  }
  return [...new Set(out)];
}

/** 仅检查 expectedNames：细纲要求出场但正文未出现 */
export function scanNamePresence(body: string, expectedNames: string[]): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const name of expectedNames) {
    if (!name || name.length < 2) continue;
    if (!body.includes(name)) {
      hits.push({
        kind: "人名疑似漂移",
        text: name,
        detail: "细纲要求出场，本章正文未出现全名（请检查是否写错/漏写）",
      });
    }
  }
  return hits;
}

/** 全名未出现，但姓名末两字出现 → 弱提示可能用了简称 */
export function scanNameShortAlias(body: string, expectedNames: string[]): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const name of expectedNames) {
    if (!name || name.length < 3) continue;
    if (body.includes(name)) continue;
    const suffix = name.slice(-2);
    if (suffix.length === 2 && body.includes(suffix)) {
      hits.push({
        kind: "人名疑似漂移",
        text: name,
        detail: `正文出现后缀「${suffix}」但未写全名，疑似用了简称`,
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

/** 启发式工艺病扫描（标语/口号/顶真/电报碎句/总结腔） */
export function scanCraftIssues(body: string): ScanHit[] {
  const hits: ScanHit[] = [];
  const text = body || "";
  if (!text.trim()) return hits;

  for (const w of CRAFT_TABOO_LINES) {
    if (w && text.includes(w)) {
      hits.push({
        kind: "工艺病",
        text: w,
        detail: "疑似标语/口号/总结腔套话，请改写成具体场面",
      });
    }
  }

  // 顶真：短句尾=下句头，连续 ≥2 次衔接
  const sentences = text
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 28);
  let chain = 0;
  for (let i = 0; i < sentences.length - 1; i++) {
    const a = sentences[i];
    const b = sentences[i + 1];
    const tail2 = a.slice(-2);
    const tail1 = a.slice(-1);
    const linked =
      (tail2.length === 2 && (b.startsWith(tail2) || b.startsWith(tail2.slice(1)))) ||
      (tail1 && b.startsWith(tail1) && a.length <= 12 && b.length <= 12);
    if (linked) {
      chain++;
      if (chain >= 2) {
        hits.push({
          kind: "工艺病",
          text: `${a} → ${b}`,
          detail: "疑似顶真连环，请打断假气势句式",
        });
        break;
      }
    } else {
      chain = 0;
    }
  }

  // 电报文：连续很多极短句（≤6字）且占比高
  const short = sentences.filter((s) => s.replace(/\s/g, "").length <= 6);
  if (sentences.length >= 8 && short.length / sentences.length >= 0.55) {
    hits.push({
      kind: "工艺病",
      text: "短句占比过高",
      detail: "疑似电报文：请补感官与人物反应，避免通篇碎片短句",
    });
  }

  // 总结腔
  if (/他(渐渐)?明白了|从今往后他|这一[战事刀枪].{0,8}让他|历史将会|正义必将/.test(text)) {
    hits.push({
      kind: "工艺病",
      text: "总结升华句",
      detail: "疑似总结腔：删掉旁白升华，改用场面收束",
    });
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
  const expected = expectedNamesFromBeats(opts.beats, opts.characterNames);
  const missing = scanNamePresence(opts.body, expected);
  const missingSet = new Set(missing.map((h) => h.text));
  const aliases = scanNameShortAlias(opts.body, expected).filter((h) => !missingSet.has(h.text));
  return [
    ...scanTaboo(opts.body, taboo),
    ...missing,
    ...aliases,
    ...scanBeatsCoverage(opts.body, opts.beats),
    ...scanCraftIssues(opts.body),
  ];
}
