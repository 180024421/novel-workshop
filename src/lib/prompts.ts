import { craftSystemAddon, craftUserChecklist } from "./craftRules";

export const SYSTEM_WRITER = `你是「大帅墨枢」小说写作助手。写中文网文/长篇，注重画面、人物声口与节奏。
规则：
1. 遵守用户给出的设定、人物卡与风格禁令。
2. 不要输出写作过程解说，直接给可用正文或结构化结果。
3. 参考范文只学节奏与语气，禁止大段照抄。
4. 用 Markdown。章节标题用「# 第X章 标题」。
5. ${craftSystemAddon()}`;

export function expandIdeaPrompt(seed: string, style: string) {
  return `请根据用户的初级想法，扩展成可写作的设定文档（Markdown），包含：
## 一句话卖点
## 世界观
## 主线冲突
## 主要人物（至少3人，含性格与声口）
## 节奏与卷结构建议
## 风格与禁忌

用户想法：
${seed}

已有风格禁令：
${style || "（无）"}`;
}

export function outlinePrompt(bible: string, seed: string, extraNotes = "") {
  return `根据设定与用户想法写全书「总纲」。总纲是全书级总述，不是章节目录。

输出 Markdown，建议结构：
# 总纲
## 一句话卖点
## 全书梗概（300～800 字，讲清主线起承转合，不要逐章罗列）
## 世界观（规则、时代、势力、关键设定）
## 主要人物（姓名/身份/动机/关系/声口）
## 主线冲突与主题
## 分卷主题（只要到「卷」：每卷一句话主题与情绪，不要写第N章）
## 风格与禁忌

硬性禁止：输出「第1章、第2章…」章节列表或章正文。章节安排属于「细纲」页。

设定：
${bible.slice(0, 12000)}

原始想法：
${seed.slice(0, 3000)}

用户补充要求：
${extraNotes.slice(0, 2000) || "（无）"}`;
}

export function normalizeOutlinePrompt(outline: string) {
  return `把下面文稿整理成「总纲」Markdown（全书总述）。要求：
1. 保留/提炼：卖点、全书梗概、世界观、人物、主线、分卷主题。
2. 删掉或移出所有「第N章」章节列表与章正文（那些属于细纲）。
3. 只输出整理后的 Markdown，不要解释。

原文：
${outline.slice(0, 20000)}`;
}

export function beatsPrompt(
  outlineChapter: string,
  bible: string,
  prevTail: string,
  extraNotes = ""
) {
  return `把下面这一章拆成「细纲」。输出 Markdown：
# 第X章细纲
## 本章目标
## 场次（按时间顺序，每场：地点/人物/冲突/结果）
## 必出场人物
## 情绪曲线
## 章末钩子
## 与上章衔接点

章纲条目：
${outlineChapter}

设定摘要：
${bible.slice(0, 8000)}

上章末尾：
${prevTail.slice(-1500) || "（无）"}

用户对本阶段的补充想法（拆细纲时务必吸收）：
${extraNotes.slice(0, 2000) || "（无）"}`;
}

export type ChapterEntry = { id: string; title: string; blurb: string };

function parseChapterListRaw(text: string): ChapterEntry[] {
  const lines = text.split(/\r?\n/);
  const out: ChapterEntry[] = [];
  const seen = new Set<string>();
  const patterns = [
    /第\s*(\d+)\s*章\s*[：:\s|｜\-—–·.]*\s*([^\n|｜\-—–]*)(?:\s*[|｜\-—–]+\s*(.*))?/,
    /^#{1,4}\s*第\s*(\d+)\s*章\s*[：:\s]*([^\n#]*)/,
    /^\s*(?:\d+[\.、)）]|[-*•])\s*第\s*(\d+)\s*章\s*[：:\s]*([^\n|｜\-—–]*)(?:\s*[|｜\-—–]+\s*(.*))?/,
  ];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```")) continue;
    let matched: ChapterEntry | null = null;
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (!m) continue;
      const id = `第${Number(m[1])}章`;
      const title =
        (m[2] || "未命名")
          .replace(/^[\s*#\-·.、：:]+/, "")
          .replace(/\s*[|｜\-—–].*$/, "")
          .trim() || "未命名";
      const blurb = (m[3] || "").trim();
      matched = { id, title, blurb };
      break;
    }
    if (!matched) continue;
    if (seen.has(matched.id)) continue;
    seen.add(matched.id);
    out.push(matched);
  }
  return out;
}

/** 从细纲（或旧总纲）里解析章节列表；优先读「章节列表」小节 */
export function parseChapterList(outline: string): ChapterEntry[] {
  if (!outline?.trim()) return [];
  const listBlock = outline.match(
    /#{1,4}\s*章节列表[^\n]*\n([\s\S]*?)(?=\n#{1,4}\s+(?!第\s*\d+\s*章)|$)/i
  );
  if (listBlock?.[1]?.trim()) {
    const fromList = parseChapterListRaw(listBlock[1]);
    if (fromList.length) return fromList;
  }
  return parseChapterListRaw(outline);
}

export function chapterPrompt(opts: {
  beats: string;
  bible: string;
  characters: string;
  style: string;
  prevTail: string;
  kb: string;
  targetWords?: number;
  openHooks?: string;
}) {
  const words = opts.targetWords ?? 2500;
  return `根据细纲写本章正文，目标 ${words} 字，务必写到 ${Math.round(words * 0.9)}～${Math.round(words * 1.15)} 字，过程戏写全，禁止草草收尾。
要求：对白有声口，环境有感官，人物动机清楚，冲突有代价。
${craftUserChecklist()}
只输出正文 Markdown。

细纲：
${opts.beats}

设定：
${opts.bible.slice(0, 6000)}

人物卡：
${opts.characters.slice(0, 4000) || "（无）"}

风格禁令：
${opts.style.slice(0, 2000)}

上章末尾（承接，勿重演同一瞬间）：
${opts.prevTail.slice(-1800) || "（开篇）"}

${opts.openHooks || ""}

${opts.kb}`;
}

export const REVISE_SHORTCUTS = [
  { id: "expand", label: "扩写", instruction: "在保持情节不变的前提下扩写，增加感官细节与对白，约变为原来的1.5倍。禁止啰嗦复述。" },
  { id: "compress", label: "压缩", instruction: "压缩冗余描写，保留冲突与关键对白，约为原来的60%。删掉总结腔与标语句。" },
  { id: "dialogue", label: "加强对白", instruction: "强化对白声口与潜台词，减少解说腔；禁止电报碎句与口号。" },
  { id: "conflict", label: "加强冲突", instruction: "加强冲突与张力，动作与反应写清楚，写出代价。" },
  { id: "pov", label: "改视角", instruction: "保持事件不变，略微收紧到主角感官视角，减少全知解说。" },
  { id: "craft", label: "去工艺病", instruction: "消灭啰嗦重复、电报文、顶真连环、标语口号、讲课总结腔；补画面与人物反应，保持情节不变。" },
  { id: "imagery", label: "加画面", instruction: "在不注水前提下补具体感官与物件细节，增强画面感。" },
] as const;

export function revisePrompt(opts: {
  selection: string;
  instruction: string;
  before: string;
  after: string;
  bible: string;
  kb: string;
  variant?: "A" | "B" | "C";
}) {
  const variantHint =
    opts.variant === "A"
      ? "方案A：稳健贴合原文语气。"
      : opts.variant === "B"
        ? "方案B：冲突更强、节奏更快。"
        : opts.variant === "C"
          ? "方案C：对白与潜台词更突出。"
          : "";
  return `只修改「选中文本」，按修改意见重写。保持前后文衔接与人物声口。
${craftUserChecklist()}
只输出改写后的选中部分正文，不要解释，不要加前后文。
${variantHint}

修改意见：
${opts.instruction}

选中文本：
${opts.selection}

前文：
${opts.before.slice(-800)}

后文：
${opts.after.slice(0, 800)}

设定摘要：
${opts.bible.slice(0, 3000)}

${opts.kb}`;
}

export function beatsCheckPrompt(beats: string, body: string) {
  const bodyForCheck =
    body.length <= 12000
      ? body
      : `${body.slice(0, 6000)}\n\n……（正文中段省略）……\n\n${body.slice(-6000)}`;
  return `对照细纲检查正文是否写全。输出 Markdown：
## 结论
## 已覆盖
## 缺失或偏离（场次/人物/钩子）
## 建议补写

细纲：
${beats.slice(0, 6000)}

正文：
${bodyForCheck}`;
}

export function extractCharactersPrompt(bible: string) {
  return `从设定文档中抽出主要人物，只输出 JSON 数组（不要 Markdown 代码围栏，不要解释）：
[{"name":"姓名","role":"身份","voice":"声口特点","traits":"性格","relationships":"关系","taboo":"禁忌","arc":"成长弧"}]

设定：
${bible.slice(0, 12000)}`;
}

export function continuityPrompt(opts: {
  prevTail: string;
  chapter: string;
  bible: string;
  characters: string;
}) {
  return `检查本章与上章末尾、设定、人物卡的连贯性。输出 Markdown：
## 结论（一句）
## 问题列表（人名漂移、设定矛盾、时间线、未兑现钩子、声口崩坏；无则写「未见明显问题」）
## 修改建议（可执行的短句）

上章末尾：
${opts.prevTail.slice(-2200) || "（开篇，无上章）"}

本章正文：
${opts.chapter.slice(0, 9000)}

设定摘要：
${opts.bible.slice(0, 4000)}

人物卡：
${opts.characters.slice(0, 3000) || "（无）"}`;
}

/** 按卷写细纲：一卷简介 + 章节列表 + 场次 */
export function volumeBeatsPrompt(opts: {
  outline: string;
  volumeId: string;
  volumeTitle: string;
  chapters: { id: string; title: string }[];
  bible: string;
  style: string;
  kb: string;
  /** 本卷目标章数，默认 30 */
  chaptersPerVolume?: number;
}) {
  const n = Math.max(8, Math.min(120, opts.chaptersPerVolume ?? 30));
  const list = opts.chapters.map((c) => `- ${c.id} ${c.title}`).join("\n");
  return `为「${opts.volumeId} ${opts.volumeTitle}」写「细纲」。细纲按卷：本卷简介 + 大量章节 + 精简场次。

输出 Markdown：
# ${opts.volumeId} ${opts.volumeTitle}
## 本卷简介（本卷目标、主线推进、情绪弧，200～500 字）
## 章节列表
- 第N章 标题 —— 一句话章核｜钩子
（本卷约 ${n} 章，至少 ${Math.max(12, Math.floor(n * 0.7))} 章；网文一卷通常有很多章，不要只写几章就收；章号与全书连续）
## 分章细纲
对列表中每一章用二级标题：
## 第N章 标题
每章场次控制在 4～8 行（开场/冲突/转折/收束/钩子），宁可短也要保证章数够，不要因写太详而砍章。

要求：
1. 必须先给出完整章节列表，再写分章细纲；列表章数与分章细纲一一对应；
2. 章与章有因果递进；
3. 不要写成长篇正文/大段对白；
4. 世界观人物细节以总纲为准，此处侧重本卷情节骨架。

已有章节线索（可调整，但最终本卷章数应接近 ${n}）：
${list || "（无，请自行规划本卷大量章节）"}

全书总纲：
${opts.outline.slice(0, 12000)}

设定：
${opts.bible.slice(0, 6000)}

风格禁令：
${opts.style.slice(0, 2000)}

${opts.kb}`;
}

export function agentSystemPrompt(
  mode: "idea" | "outline" | "beats" | "chapter",
  meta: string
) {
  const role =
    mode === "idea"
      ? `你是「设定」顾问（当前：设定页）。
帮用户聊原始构想、卖点试写、风格禁令。可粗谈世界观与人物，但成书级总述请引导去「总纲」。
硬性禁止：写章节列表、章正文、连载叙事。
若用户要「章目录/每卷章节」，引导去左侧「细纲」；要「全书梗概+世界观+人物成稿」引导去「总纲」。`
      : mode === "outline"
        ? `你是「总纲」策划（当前：总纲页）。
总纲 = 全书大体介绍：卖点、全书梗概、世界观、主要人物、主线冲突、分卷主题。
硬性禁止：
- 禁止输出「第1章、第2章…」章节列表（那是「细纲」的事）；
- 禁止写每章场次或小说正文。
若用户坚持要拆章，明确说：请到「细纲」按卷写章节与场次。
落稿结构：## 一句话卖点 / ## 全书梗概 / ## 世界观 / ## 主要人物 / ## 主线冲突 / ## 分卷主题 / ## 风格与禁忌。`
        : mode === "beats"
          ? `你是「细纲」策划（当前：细纲·按卷）。
细纲 = 某一卷的具体简介 + 本卷大量章节列表 + 各章精简场次。
网文一卷通常有很多章（常见 20～40+，以用户约定为准），禁止只排几章就交差。
硬性禁止：写完整章节正文；把本卷写成与总纲重复的纯世界观长文。
落稿须含：本卷简介、章节列表（- 第N章 …，章数要够）、以及 \`## 第N章\` 场次（每章宜短，保证章数）。`
          : `你是「正文」写手顾问（当前：正文页）。
先聊本章目标与情绪，再生成或改写本章正文。不要改写成总纲或细纲。
用户可随时要求「连贯检查」（对照细纲/前后章情绪是否断裂）或「人物声口对照」（按人物卡改对白）；有此类诉求时优先做局部诊断与改写建议，再落稿。
硬性工艺：禁止啰嗦、重复、电报文、顶真连环、标语体、口号体；人物要丰满，场面要有画面与张力，典故与修辞点到为止。`;

  return `${role}

${craftSystemAddon()}

当前上下文：
${meta}

回复用简体中文。对话以澄清为主；落稿时在末尾用 \`\`\`markdown 给出可写入本页编辑器的内容。`;
}

/** 选区 / 全文改写模式：Agent 只产出可替换的正文 */
export function selectionEditSystemAddon(opts: {
  kind: "selection" | "document";
  label: string;
  text: string;
  before: string;
  after: string;
}) {
  const scope =
    opts.kind === "document"
      ? `用户锁定了「整篇${opts.label}」作为改写范围。`
      : `用户锁定了编辑器中的一段选区（约 ${opts.text.replace(/\s+/g, "").length} 字）。`;
  return `${scope}
你的任务：按用户描述，只改写这段锁定文本，保持人物声口与前后文衔接。
硬性要求：
- 最终落稿时，在回复末尾用 \`\`\`markdown … \`\`\` 只输出「改写后的锁定文本」；
- 不要输出锁定范围之外的前后文；不要解释性套话包在代码块里；
- 若只需讨论、暂不改写，可以先聊，等用户明确要求再给代码块。

锁定文本：
${opts.text.slice(0, 12000)}

前文（衔接用，勿原样输出）：
${opts.before.slice(-1200) || "（无）"}

后文（衔接用，勿原样输出）：
${opts.after.slice(0, 1200) || "（无）"}`;
}

export function generateFromChatPrompt(opts: {
  mode: "idea" | "outline" | "beats" | "chapter";
  transcript: string;
  context: string;
  /** 细纲：本卷目标章数 */
  chaptersPerVolume?: number;
  /** 细纲：list=只出章节目录；full=简介+目录+场次 */
  beatsPhase?: "list" | "full";
}) {
  if (opts.mode === "idea") {
    return `【任务：生成「设定」草稿】
输出构想/设定 Markdown（卖点、世界观草案、人物草案、风格禁忌）。
禁止章节列表与章正文。章节安排属于「细纲」。

只输出 Markdown，不要解释。

对话：
${opts.transcript.slice(-12000)}

参考：
${opts.context.slice(0, 10000)}`;
  }

  if (opts.mode === "outline") {
    return `【任务：生成「总纲」——全书大体介绍，不是章节目录】
输出 Markdown：
# 总纲
## 一句话卖点
## 全书梗概（主线起承转合，不要逐章）
## 世界观
## 主要人物
## 主线冲突与主题
## 分卷主题（每卷一句话，不要第N章）
## 风格与禁忌

硬性禁止：任何「第N章」列表、场次细纲、小说正文。
对话里若已有章目录，只提炼进梗概/分卷主题，不要按章罗列。

只输出 Markdown，不要解释。

对话：
${opts.transcript.slice(-12000)}

参考：
${opts.context.slice(0, 10000)}`;
  }

  if (opts.mode === "beats") {
    const n = Math.max(8, Math.min(120, opts.chaptersPerVolume ?? 30));
    const phase = opts.beatsPhase || "full";
    if (phase === "list") {
      return `【任务：只生成本卷「章节列表」——要很多章】
输出 Markdown：
# 第N卷 卷名
## 本卷简介（可短）
## 章节列表
- 第N章 标题 —— 章核｜钩子

硬性要求：
1. 本卷约 ${n} 章（至少 ${Math.max(12, Math.floor(n * 0.7))} 章），网文一卷本来就该有很多章；
2. 章号全书连续；章与章有因果递进；
3. 本阶段不要写「分章细纲」场次，也不要写正文。

只输出 Markdown，不要解释。

对话：
${opts.transcript.slice(-12000)}

参考：
${opts.context.slice(0, 10000)}`;
    }
    return `【任务：生成本卷「细纲」——本卷简介 + 很多章 + 精简场次】
输出 Markdown：
# 第N卷 卷名
## 本卷简介
## 章节列表
- 第N章 标题 —— 章核｜钩子
（约 ${n} 章，至少 ${Math.max(12, Math.floor(n * 0.7))} 章；不要只写几章）
## 分章细纲
（每章 ## 第N章 标题，场次 4～8 行：开场/冲突/转折/收束/钩子）

硬性要求：先完整列出全部章节，再写场次；宁可场次短，也要保证章数够。
禁止写完整章正文；世界观长文以总纲为准。

只输出 Markdown，不要解释。

对话：
${opts.transcript.slice(-12000)}

参考：
${opts.context.slice(0, 10000)}`;
  }

  return `【任务：生成本章正文】
严格按「参考」里的本章细纲写本章小说正文 Markdown，不要写成别的章或另起无关剧情。
章标题用「# 第X章 标题」。只输出正文，不要解释。

对话：
${opts.transcript.slice(-12000)}

参考：
${opts.context.slice(0, 12000)}`;
}

export function modeAgentHint(mode: "idea" | "outline" | "beats" | "chapter") {
  if (mode === "idea") return "设定草稿 · 不成章目录";
  if (mode === "outline") return "总纲 · 全书梗概/世界观/人物";
  if (mode === "beats") return "细纲 · 本卷简介与章节";
  return "正文 · 写本章";
}

export function modeGenerateButtonLabel(mode: "idea" | "outline" | "beats" | "chapter") {
  if (mode === "idea") return "根据对话生成设定";
  if (mode === "outline") return "根据对话生成总纲";
  if (mode === "beats") return "根据对话生成本卷细纲";
  return "根据对话生成本章正文";
}

export function modeGenerateListButtonLabel() {
  return "先生成本卷章节目录";
}

/** 落稿生成用的 system：设定/总纲/细纲不能用「写正文」那套 */
export function generateSystemPrompt(mode: "idea" | "outline" | "beats" | "chapter") {
  if (mode === "chapter") {
    return `你是「大帅墨枢」正文写手。必须按给定本章细纲写正文，禁止改写成其他章。用简体中文 Markdown。`;
  }
  if (mode === "idea") {
    return `你是「大帅墨枢」设定草稿生成器。只输出设定类 Markdown，不写章节列表与正文。`;
  }
  if (mode === "outline") {
    return `你是「大帅墨枢」总纲生成器。总纲=全书梗概+世界观+人物+分卷主题。严禁输出第N章列表或正文。`;
  }
  return `你是「大帅墨枢」细纲生成器。细纲=本卷简介+大量章节列表（一卷常见 20～40+ 章）+精简场次。宁可场次短也要章数够。不写完整章正文。`;
}
