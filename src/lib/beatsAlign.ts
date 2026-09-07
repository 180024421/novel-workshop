/** 细纲场次 ↔ 正文覆盖粗对齐 */

export type BeatAlignRow = {
  title: string;
  keywords: string[];
  covered: boolean;
  hitCount: number;
};

/** 从细纲 markdown 抽场次标题行 */
export function extractBeatSceneTitles(beats: string): string[] {
  const lines = (beats || "").split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const m =
      line.match(/^#{2,3}\s*场次\s*[:：]?\s*(.+)$/) ||
      line.match(/^#{2,3}\s*(\d+[\.、．]\s*.+)$/) ||
      line.match(/^[-*•]\s*(.+)$/);
    if (m) {
      const t = m[1].replace(/（预估[^）]*）/g, "").trim();
      if (t.length >= 2 && t.length <= 40 && !/必出场|章末|目标|字数/.test(t)) out.push(t);
    }
  }
  return [...new Set(out)].slice(0, 20);
}

function keywordsFromTitle(title: string): string[] {
  const clean = title.replace(/[（(].*?[）)]/g, "").trim();
  const parts = clean.split(/[·\-—：:，,、\s]+/).filter((x) => x.length >= 2);
  return [...new Set([clean.slice(0, 8), ...parts])].filter((x) => x.length >= 2).slice(0, 4);
}

export function alignBeatsToBody(beats: string, body: string): BeatAlignRow[] {
  const titles = extractBeatSceneTitles(beats);
  return titles.map((title) => {
    const keywords = keywordsFromTitle(title);
    let hitCount = 0;
    for (const k of keywords) {
      if (body.includes(k)) hitCount++;
    }
    return {
      title,
      keywords,
      covered: hitCount > 0,
      hitCount,
    };
  });
}
