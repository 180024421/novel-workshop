import { loadCharactersMarkdown } from "./characters";
import { chatCompletion } from "./gateway";
import { formatOpenHooksForPrompt, loadHooksLedger } from "./hooksLedger";
import { SYSTEM_WRITER } from "./prompts";
import { loadProjectProgress } from "./projectProgress";
import type { ProviderConfig } from "./providerPresets";
import type { AppSettings } from "../types";
import { volumeBeatsPath } from "./volumes";

export function buildVolumeCheckPrompt(opts: {
  volumeId: string;
  volumeTitle?: string;
  beatsSummary: string;
  characters: string;
  openHooks: string;
  chapterTitles: string[];
}): string {
  const titleLine = opts.volumeTitle?.trim()
    ? `${opts.volumeId} ${opts.volumeTitle.trim()}`
    : opts.volumeId;
  const chapters =
    opts.chapterTitles.length > 0
      ? opts.chapterTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")
      : "（本卷尚无章节标题）";

  return `请对本卷做「一致性体检」，输出 Markdown 报告（不要代码围栏），包含以下小节：
## 人物弧缺口
## 时间线疑点
## 势力/地图前后矛盾
## 未回收钩子
## 总体建议

只基于给定材料；不确定处标明「待核实」。不要改正文，只诊断。

# 体检对象
${titleLine}

# 本卷已写/规划章节标题
${chapters}

# 本卷细纲摘要
${opts.beatsSummary.slice(0, 14000) || "（无细纲）"}

# 人物卡摘要
${opts.characters.slice(0, 8000) || "（无人物卡）"}

# 开放钩子/伏笔
${opts.openHooks || "（无开放钩子）"}
`;
}

export async function runVolumeCheck(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  volumeId: string;
  volumeTitle?: string;
  settings: AppSettings;
  providers: ProviderConfig[];
  signal?: AbortSignal;
}): Promise<{ report: string; path: string }> {
  if (!window.moshu) throw new Error("桌面端未就绪");

  const beatsPath = await opts.join(opts.root, "beats", volumeBeatsPath(opts.volumeId));
  const beatsSummary = await window.moshu.readText(beatsPath);
  const characters = await loadCharactersMarkdown(opts.root, opts.join);
  const ledger = await loadHooksLedger(opts.root, opts.join);
  const openHooks = formatOpenHooksForPrompt(ledger, 40);
  const prog = await loadProjectProgress(opts.root, opts.join);
  const chapterTitles = prog.chapterRows
    .filter((r) => r.volumeId === opts.volumeId)
    .map((r) => `${r.id} ${r.title}${r.hasChapter ? "" : "（未写）"}`);

  const prompt = buildVolumeCheckPrompt({
    volumeId: opts.volumeId,
    volumeTitle: opts.volumeTitle,
    beatsSummary,
    characters,
    openHooks,
    chapterTitles,
  });

  const report = await chatCompletion(
    opts.settings,
    [
      { role: "system", content: SYSTEM_WRITER },
      { role: "user", content: prompt },
    ],
    {
      model: opts.settings.routeCheck || "复杂",
      providers: opts.providers,
      stream: false,
      signal: opts.signal,
    }
  );

  const stamped = `# ${opts.volumeId} 卷级一致性检查\n\n生成于 ${new Date().toISOString()}\n\n${report.trim()}\n`;
  const outName = `volume-check-${opts.volumeId}.md`;
  const path = await opts.join(opts.root, "continuity", outName);
  await window.moshu.writeText(path, stamped);
  return { report: stamped, path };
}
