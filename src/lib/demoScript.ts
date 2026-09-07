/** 官方样例 · 3 分钟演示脚本 */

export const DEMO_3MIN = {
  title: "3 分钟演示：夜市刀客",
  steps: [
    {
      n: 1,
      text: "首页点「打开样例书」→ 进入正文第1章，扫一眼对白烟火气",
      to: "/",
    },
    {
      n: 2,
      text: "侧栏「扩展包」→「一键补工艺红线」（或确认样例已含工艺）",
      to: "/app/packs",
    },
    {
      n: 3,
      text: "「本书健康分」看四维仪表：细纲 / 钩子 / 工艺 / 摘要",
      to: "/app/health",
    },
    {
      n: 4,
      text: "正文工具：扫描工艺病 → 一键润色 → 必出改前/改后 Diff",
      to: "/app/chapter",
    },
    {
      n: 5,
      text: "「声口体检」抽检对白 →「一键改对白」回写有问题的章",
      to: "/app/voice-check",
    },
  ],
  tip: "推荐路径：工艺包 → 健康分 → 再写新章。写章前可开「上下文预览」，勾选块会作为 contextBlocks 显式注入。",
};

export function formatDemoScriptMarkdown(): string {
  const lines = DEMO_3MIN.steps.map((s) => `${s.n}. ${s.text}`);
  return `# ${DEMO_3MIN.title}\n\n${lines.join("\n")}\n\n> ${DEMO_3MIN.tip}\n`;
}
