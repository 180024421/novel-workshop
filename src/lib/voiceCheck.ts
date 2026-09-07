/** 声口一致性体检 */

export type VoiceIssue = {
  chapterId: string;
  name: string;
  detail: string;
  sample: string;
};

export type VoiceCheckReport = {
  issues: VoiceIssue[];
  checkedChapters: number;
  checkedCharacters: number;
  summary: string;
};

/** 粗抽「姓名道/说/问」类对白行 */
export function extractDialogueLines(body: string, name: string): string[] {
  if (!name || name.length < 2) return [];
  const lines = (body || "").split(/\r?\n/);
  const out: string[] = [];
  const re = new RegExp(
    `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,8}[道说问喊骂笑冷][道说道]?[：:]`
  );
  for (const line of lines) {
    const t = line.trim();
    if (re.test(t) || (t.includes(name) && /[「“"]/.test(t))) {
      out.push(t.slice(0, 120));
      if (out.length >= 8) break;
    }
  }
  return out;
}

export function voiceCheckPrompt(opts: {
  charactersMarkdown: string;
  samples: { chapterId: string; name: string; lines: string[] }[];
}): string {
  const blocks = opts.samples
    .map(
      (s) =>
        `### ${s.name} @ ${s.chapterId}\n${s.lines.map((l) => `- ${l}`).join("\n") || "（无对白样本）"}`
    )
    .join("\n\n");
  return `对照人物卡声口，检查下列对白是否「串戏」（用词/语气/身份不符）。
只输出 Markdown：
## 摘要
## 问题列表
- 章号｜人物｜问题｜摘录

人物卡：
${opts.charactersMarkdown.slice(0, 8000)}

样本：
${blocks.slice(0, 14000)}`;
}

export function parseVoiceIssues(raw: string): VoiceIssue[] {
  const issues: VoiceIssue[] = [];
  for (const line of (raw || "").split(/\r?\n/)) {
    const m = line.match(/^[-*•]\s*(第?\d+章)?\s*[｜|]\s*([^｜|]+)\s*[｜|]\s*([^｜|]+)\s*[｜|]\s*(.+)$/);
    if (!m) continue;
    issues.push({
      chapterId: (m[1] || "").trim() || "未知章",
      name: m[2].trim(),
      detail: m[3].trim(),
      sample: m[4].trim(),
    });
  }
  return issues;
}

/** 按声口问题改写本章对白（输出整章 Markdown） */
export function voiceFixPrompt(opts: {
  chapterId: string;
  body: string;
  charactersMarkdown: string;
  issues: VoiceIssue[];
}): string {
  const lines = opts.issues
    .slice(0, 16)
    .map((i) => `- ${i.name}｜${i.detail}｜摘录：${i.sample}`)
    .join("\n");
  return `按人物卡声口改写本章对白，消灭「串戏」。
规则：
- 只改对白与紧邻说话标签，旁白情节、章结构、人名尽量不动
- 输出完整本章 Markdown 正文（不要解释、不要对照表）
- 若问题摘录已不在正文，跳过该项

本章：${opts.chapterId}

人物卡：
${opts.charactersMarkdown.slice(0, 6000)}

问题列表：
${lines || "（无结构化问题，请通篇校对主要角色对白是否串戏）"}

正文：
${opts.body.slice(0, 28000)}`;
}

export function groupVoiceIssuesByChapter(
  issues: VoiceIssue[]
): Map<string, VoiceIssue[]> {
  const map = new Map<string, VoiceIssue[]>();
  for (const iss of issues) {
    const id = iss.chapterId || "未知章";
    const list = map.get(id) || [];
    list.push(iss);
    map.set(id, list);
  }
  return map;
}
