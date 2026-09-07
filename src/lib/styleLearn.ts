/** 从已有正文学习文风 → style.md 草稿 */

import { mergeCraftStyle } from "./craftUpgrade";
import { listChapterFilesFromDisk } from "./volumes";

export type StyleSample = { chapterId: string; title: string; excerpt: string };

export function styleLearnPrompt(opts: { samples: StyleSample[] }): string {
  const blocks = opts.samples
    .map(
      (s) =>
        `### ${s.chapterId} ${s.title}\n${s.excerpt.slice(0, 1800)}`
    )
    .join("\n\n");
  return `你是网文文风分析助手。根据下列正文样本，总结「可复用的风格卡」，输出 Markdown（不要代码围栏），结构固定为：

## 句长与节奏
## 视角与人称
## 对白与叙述比
## 常用句式
## 口头禅 / 标志词
## 忌用（本书应避免）
## 人物声口补充（可选）

要求：具体、可执行，少空话；忌用项写成可并入禁忌列表的短语。

样本：
${blocks.slice(0, 14000)}`;
}

export function parseStyleDraft(raw: string): {
  styleMd: string;
  voiceNotes: string;
} {
  const text = (raw || "").trim();
  if (!text) return { styleMd: "", voiceNotes: "" };
  const voiceMatch = text.match(
    /##\s*人物声口补充[\s\S]*?(?=##\s|$)/
  );
  const voiceNotes = voiceMatch ? voiceMatch[0].trim() : "";
  let styleMd = text;
  if (voiceMatch) {
    styleMd = text.replace(voiceMatch[0], "").trim();
  }
  if (!/^#/.test(styleMd)) {
    styleMd = `# 文风卡（学习生成）\n\n${styleMd}`;
  }
  return { styleMd, voiceNotes };
}

/** 采样最多 8 章有正文的章，各截取一段 */
export async function sampleChaptersForStyle(
  root: string,
  join: (...p: string[]) => Promise<string>,
  limit = 8
): Promise<StyleSample[]> {
  const listed = await listChapterFilesFromDisk(root, join);
  const withBody = listed.filter((c) => c.body.trim().length > 80).slice(0, limit);
  return withBody.map((c) => ({
    chapterId: c.id,
    title: c.title,
    excerpt: c.body.replace(/\s+/g, " ").slice(0, 2000),
  }));
}

export function mergeLearnedStyle(existing: string, learned: string): string {
  const draft = (learned || "").trim();
  if (!draft) return existing;
  // 先保留工艺红线，再挂学习结果
  const withCraft = mergeCraftStyle(existing);
  if (/文风卡（学习生成）|句长与节奏/.test(withCraft)) {
    return `${draft}\n\n## 原有风格（合并前）\n${existing.trim()}\n`;
  }
  return `${withCraft.trim()}\n\n---\n\n${draft}\n`;
}

export async function applyLearnedStyle(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  styleMd: string;
}): Promise<{ path: string; merged: string }> {
  if (!window.moshu) throw new Error("需要桌面端");
  const path = await opts.join(opts.root, "prompts", "style.md");
  const existing = await window.moshu.readText(path);
  const merged = mergeLearnedStyle(existing, opts.styleMd);
  await window.moshu.writeText(path, merged);
  return { path, merged };
}
