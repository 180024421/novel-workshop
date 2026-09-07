import type { SceneBudget } from "./writePipelineUtils";
import { craftPolishAddon, craftUserChecklist } from "./craftRules";

export function briefPrompt(ctx: {
  beats: string;
  bible: string;
  characters: string;
  style: string;
  prevTail: string;
  hooks: string;
  targetWords: number;
}) {
  return `根据材料写「本章写作简报」（短，供后续分场写作用）。输出 Markdown：
## 冲突核
## 情绪弧
## 必写点（条目）
## 禁踩雷（含：啰嗦重复/电报文/顶真/标语口号等工艺病）
不要写正文。目标全章约 ${ctx.targetWords} 字。

细纲：
${ctx.beats.slice(0, 8000)}
设定：
${ctx.bible.slice(0, 4000)}
人物：
${ctx.characters.slice(0, 3000)}
风格：
${ctx.style.slice(0, 1500)}
上章末：
${ctx.prevTail.slice(-1500) || "（开篇）"}
${ctx.hooks}`;
}

export function planPrompt(ctx: {
  brief: string;
  beats: string;
  targetWords: number;
}) {
  return `把本章拆成 3～8 个场次，并分配字数预算，总和必须等于 ${ctx.targetWords}。
每行格式严格：\`序号. 场次标题｜预算整数\`
只输出场次列表，不要解释。

简报：
${ctx.brief.slice(0, 4000)}
细纲：
${ctx.beats.slice(0, 6000)}`;
}

export function scenePrompt(ctx: {
  brief: string;
  scene: SceneBudget;
  sceneIndex: number;
  sceneTotal: number;
  prevSceneTail: string;
  characters: string;
  style: string;
  isFirst: boolean;
  chapterTitle: string;
  chapterId: string;
}) {
  return `写本章第 ${ctx.sceneIndex}/${ctx.sceneTotal} 场「${ctx.scene.title}」正文。
硬性：本场约 ${ctx.scene.budget} 字（务必写到该预算的 90% 以上再收束）；只输出本场正文 Markdown，不要解说。
${ctx.isFirst ? `章标题行：# ${ctx.chapterId} ${ctx.chapterTitle}` : "不要重复章标题；直接从本场接着写。"}
过程戏写全，对白有声口，环境有感官，冲突有代价。
${craftUserChecklist()}

简报：
${ctx.brief.slice(0, 3000)}
人物声口：
${ctx.characters.slice(0, 2500)}
风格：
${ctx.style.slice(0, 1200)}
上一场末尾（承接，勿重演）：
${ctx.prevSceneTail.slice(-800) || "（本场开篇）"}`;
}

export function continuePrompt(ctx: {
  body: string;
  wordsNow: number;
  targetWords: number;
  gap: number;
  brief: string;
}) {
  return `下面正文目前约 ${ctx.wordsNow} 字，目标 ${ctx.targetWords} 字，还差约 ${ctx.gap} 字。
从断点继续写，补足缺口；禁止复述已写情节；禁止注水啰嗦、电报碎句、标语口号；只输出续写部分（不要重复已有正文）。
${craftUserChecklist()}

简报：
${ctx.brief.slice(0, 2000)}
已有正文末尾：
${ctx.body.slice(-2500)}`;
}

export function compressPrompt(ctx: {
  body: string;
  wordsNow: number;
  targetWords: number;
}) {
  return `正文约 ${ctx.wordsNow} 字，超过目标 ${ctx.targetWords}。轻度压缩冗余描写，保留冲突、对白与章末钩子；优先删啰嗦重复与空喊句。
目标压缩到约 ${ctx.targetWords} 字。只输出压缩后的完整正文 Markdown。

原文：
${ctx.body.slice(0, 28000)}`;
}

export function beatsFixPrompt(ctx: {
  beats: string;
  body: string;
  checkReport: string;
}) {
  return `根据「缺失或偏离」补写正文中缺的部分。只输出需要插入/替换的补写段落（可多段），不要重写全章，不要解释。

细纲：
${ctx.beats.slice(0, 5000)}
自检报告：
${ctx.checkReport.slice(0, 4000)}
现有正文（参考）：
${ctx.body.slice(0, 12000)}`;
}

export function polishPrompt(ctx: {
  body: string;
  prevTail: string;
  bible: string;
  characters: string;
}) {
  return `润色本章：修正与上章衔接、人名漂移、设定矛盾、声口崩坏。
${craftPolishAddon()}
保持情节与字数大致不变。只输出润色后完整正文。

上章末：
${ctx.prevTail.slice(-1800) || "（开篇）"}
设定：
${ctx.bible.slice(0, 3000)}
人物：
${ctx.characters.slice(0, 2500)}
正文：
${ctx.body.slice(0, 28000)}`;
}
