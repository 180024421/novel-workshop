import { parseChapterFileName } from "./chapterFiles";
import { countTextWords } from "./projectProgress";
import { exportRichBook } from "./exportRich";
import {
  appendWordCountFooter,
  formatForPlatform,
  sanitizeExportFileName,
  type PlatformFormatId,
} from "./platformFormat";

export type ExportFormat = "markdown" | "qidian" | "feilu" | "plain" | "tomato" | "epub" | "docx";

function toPlatformId(format: ExportFormat): PlatformFormatId | null {
  if (format === "qidian" || format === "plain" || format === "tomato") return format;
  return null;
}

function formatChapterBody(body: string, format: ExportFormat, words: number): string {
  const platform = toPlatformId(format);
  if (!platform) {
    return body.replace(/^#\s*第\d+章[^\n]*\n+/, "");
  }
  let text = formatForPlatform(body, platform);
  if (format === "qidian" || format === "tomato" || format === "plain") {
    text = appendWordCountFooter(text, words);
  }
  return text;
}

export async function exportBook(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  title: string;
  format: ExportFormat;
  /** 是否应用平台排版 + 字数脚注；默认对 qidian/tomato/plain 开启 */
  applyPlatformFormat?: boolean;
}): Promise<{ path: string; words: number; chapters: number }> {
  if (opts.format === "epub" || opts.format === "docx") {
    return exportRichBook({
      root: opts.root,
      join: opts.join,
      title: opts.title,
      format: opts.format,
    });
  }

  if (!window.moshu) throw new Error("需要桌面端");
  const files = await window.moshu.listDir(await opts.join(opts.root, "chapters"));
  const md = files
    .filter((f) => f.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));

  const parts: string[] = [];
  let words = 0;
  let chapters = 0;
  const applyFmt = opts.applyPlatformFormat !== false;

  if (opts.format === "markdown") {
    parts.push(`# ${opts.title}\n`);
  } else if (opts.format === "qidian" || opts.format === "tomato") {
    parts.push(`${opts.title}\n\n`);
  } else if (opts.format === "feilu") {
    parts.push(`【书名】${opts.title}\n\n`);
  }

  for (const f of md) {
    const body = (await window.moshu.readText(f.path)).trim();
    if (!body) continue;
    chapters++;
    const chapWords = countTextWords(body);
    words += chapWords;
    const parsed = parseChapterFileName(f.name);
    const chapTitle = parsed
      ? `${parsed.id} ${parsed.title}`
      : f.name.replace(/\.md$/, "");

    if (opts.format === "markdown") {
      parts.push(body.startsWith("#") ? body : `# ${chapTitle}\n\n${body}`);
      parts.push("\n\n---\n");
    } else if (opts.format === "feilu") {
      parts.push(`### ${chapTitle}\n\n`);
      parts.push(body.replace(/^#\s*第\d+章[^\n]*\n+/, "") + "\n\n");
    } else if (applyFmt && toPlatformId(opts.format)) {
      parts.push(`${chapTitle}\n\n`);
      parts.push(formatChapterBody(body, opts.format, chapWords) + "\n\n");
    } else {
      parts.push(`${chapTitle}\n\n${body.replace(/^#\s*第\d+章[^\n]*\n+/, "")}\n\n\n`);
    }
  }

  const content = parts.join("\n");
  const ext = opts.format === "markdown" ? "md" : "txt";
  const safeTitle = sanitizeExportFileName(opts.title || "全书");
  const base = sanitizeExportFileName(`${safeTitle}_${opts.format}`);
  const outPath = await opts.join(opts.root, "export", `${base}.${ext}`);
  await window.moshu.writeText(outPath, content);

  if (window.moshu.saveFile) {
    const saved = await window.moshu.saveFile({
      defaultPath: `${base}.${ext}`,
      content,
      filters:
        ext === "md"
          ? [{ name: "Markdown", extensions: ["md"] }]
          : [{ name: "文本", extensions: ["txt"] }],
    });
    return { path: saved || outPath, words, chapters };
  }
  return { path: outPath, words, chapters };
}

/** 按每卷章数切成多个 TXT，再打成一个 zip 放到下载目录 */
export async function exportVolumeZip(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  title: string;
  format?: ExportFormat;
  chaptersPerVolume?: number;
}): Promise<{ ok: boolean; message: string; filePath?: string; volumes?: number }> {
  if (!window.moshu?.exportVolumeZip) {
    const r = await exportBook({
      root: opts.root,
      join: opts.join,
      title: opts.title,
      format: opts.format || "qidian",
    });
    return {
      ok: true,
      message: `已导出单文件（当前环境不支持分卷 zip）：${r.path}`,
      filePath: r.path,
      volumes: 1,
    };
  }
  return window.moshu.exportVolumeZip({
    root: opts.root,
    title: sanitizeExportFileName(opts.title),
    format: opts.format || "qidian",
    chaptersPerVolume: opts.chaptersPerVolume || 30,
  });
}
