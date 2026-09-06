/** 三分钟样例书内容 */

export const SAMPLE = {
  title: "大帅墨枢样例·夜市刀客",
  genre: "爽文",
  seed: `写一部短篇爽文样例：
主角陈刀，夜市卖烤串的退伍兵，偶然捡到一把会「说话」的旧刀。
刀里住着前朝刀客残魂，逼他重出江湖。
前三章：捡刀 → 地痞找茬打脸 → 发现刀能预知杀意。
偏现实感，少玄幻术语，对白有烟火气。`,
  style: `- 对白口语、有烟火气
- 打戏短而狠，忌流水账
- 禁止「目光如炬」「不禁」等套话
- 章末留钩子
`,
  taboo: `- 总之
- 总而言之
- 不禁
- 目光如炬
- 嘴角微微上扬
- 杀气腾腾
- 心中暗道
`,
  bible: `# 夜市刀客 · 设定

## 一句话卖点
退伍兵在夜市捡到会说话的旧刀，被迫重出江湖，一刀一串香。

## 世界观
当代南方小城夜市。刀魂存在，但不张扬；外人只当主角身手好。

## 主线冲突
地痞与背后收保护费的「黄老板」逼宫；刀魂要主角杀回旧仇，主角只想护住摊位与妹妹学费。

## 主要人物
- 陈刀：三十出头，话少，手稳，欠过人情。声口短句、带点痞。
- 刀魂「阿烬」：冷、促狭，只在陈刀脑内说话。
- 陈小满：陈刀妹妹，高中生，嘴甜会记账。
- 黄老板：笑面虎，收夜市保护费。

## 节奏与卷结构建议
短篇样例 8 章内起冲突、打脸、留大钩子。

## 风格与禁忌
烟火气；禁止网文套话。
`,
  outline: `# 总纲

## 卷概述
样例短篇：捡刀、护摊、打脸、发现刀的真正用途。

## 章节列表
- 第1章 夜市捡刀 —— 收摊遇雨｜刀魂初醒
- 第2章 三串羊肉 —— 地痞砸摊｜阿烬出声
- 第3章 刀响一声 —— 巷口反杀｜黄老板盯上
- 第4章 保护费 —— 谈判破裂｜小满被吓
- 第5章 旧疤 —— 刀魂提起旧仇｜陈刀拒绝
- 第6章 雨夜跟踪 —— 发现黄老板货仓｜半箱军刺
- 第7章 摊位不撤 —— 正面对刚｜打脸立威
- 第8章 刀要血 —— 阿烬索代价｜更大势力入场
`,
  beats1: `# 第1章细纲

## 本章目标
陈刀收摊遇暴雨，捡到旧刀；刀魂含糊说一句话。

## 场次
1. 夜市尾声，雨至，小满催收摊
2. 垃圾桶旁捡到油布包旧刀
3. 回出租屋擦刀，脑内响起「别碰血」
4. 章末：窗外有人盯摊位方向

## 必出场人物
陈刀、陈小满、阿烬（初醒）

## 情绪曲线
疲→奇→寒意

## 章末钩子
窗外黑伞人影；刀说「他来了」。

## 与上章衔接点
开篇。
`,
  chapter1: `# 第1章 夜市捡刀

雨是后半夜突然砸下来的。

陈刀把最后一炉炭摁灭，铁签子在桶里碰撞，像一小阵稀疏的枪声。陈小满撑着伞站在摊边，校服袖口挽到肘，算盘敲得噼啪响：「哥，今天一百二，油费扣了还剩——」

「行了。」陈刀把围裙扯下来，「回去睡。」

巷口的下水道冒着热气。他弯腰捡被风刮跑的油布，指尖触到硬物——一把刀，鞘是旧的，缠着发黑的布条。刀柄沉，沉得不像夜市能捡到的东西。

回到出租屋，他用抹布擦鞘。布一蹭，掌心发烫。

「别碰血。」

声音不在门外，在颅骨里头。陈刀动作停住，盯着刀：「谁？」

沉默两秒。那声音带笑，冷的：「你捡都捡了。我叫阿烬。」

窗外雨更大。巷口一盏路灯下，有人撑着黑伞，伞沿对准他们摊位的方向，久久不动。

刀忽然又响了一句：「他来了。」
`,
};

export async function seedSampleProject(
  root: string,
  join: (...p: string[]) => Promise<string>
) {
  if (!window.moshu) throw new Error("需要桌面端");
  const w = window.moshu;
  await w.writeText(await join(root, "ideas", "seed.md"), SAMPLE.seed);
  await w.writeText(await join(root, "prompts", "style.md"), SAMPLE.style);
  await w.writeText(await join(root, "prompts", "taboo.md"), SAMPLE.taboo);
  await w.writeText(await join(root, "bible", "world.md"), SAMPLE.bible);
  await w.writeText(await join(root, "outlines", "outline.md"), SAMPLE.outline);
  await w.writeText(await join(root, "beats", "第1章.md"), SAMPLE.beats1);
  await w.writeText(await join(root, "chapters", "第1章_夜市捡刀.md"), SAMPLE.chapter1);
  await w.writeJson(await join(root, "characters", "陈刀.json"), {
    id: "char_sample_1",
    name: "陈刀",
    role: "主角·夜市摊主",
    voice: "短句、带痞",
    traits: "话少手稳",
    relationships: "妹妹小满；刀魂阿烬",
    taboo: "不装英雄",
    arc: "被迫出刀",
  });
  await w.writeText(
    await join(root, "characters", "陈刀.md"),
    `# 陈刀\n\n- 身份：主角·夜市摊主\n- 声口：短句、带痞\n- 性格：话少手稳\n`
  );
  await w.writeJson(await join(root, "continuity", "hooks.json"), {
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: "hook_sample_1",
        fromChapter: "第1章",
        text: "黑伞人盯着摊位",
        kind: "钩子",
        status: "open",
        createdAt: new Date().toISOString(),
      },
      {
        id: "hook_sample_2",
        fromChapter: "第1章",
        text: "刀魂阿烬说「别碰血」",
        kind: "伏笔",
        status: "open",
        createdAt: new Date().toISOString(),
      },
    ],
  });
}
