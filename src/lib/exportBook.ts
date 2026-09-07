import { countTextWords } from "./projectProgress";
import { exportRichBook } from "./exportRich";

export type ExportFormat = "markdown" | "qidian" | "feilu" | "plain" | "epub" | "docx";

export async function exportBook(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  title: string;
  format: ExportFormat;
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

  if (opts.format === "markdown") {
    parts.push(`# ${opts.title}\n`);
  } else if (opts.format === "qidian") {
    parts.push(`${opts.title}\n\n`);
  } else if (opts.format === "feilu") {
    parts.push(`【书名】${opts.title}\n\n`);
  }

  for (const f of md) {
    const body = (await window.moshu.readText(f.path)).trim();
    if (!body) continue;
    chapters++;
    words += countTextWords(body);
    const m = f.name.match(/^(第\d+章)_(.+)\.md$/);
    const chapTitle = m ? `${m[1]} ${m[2]}` : f.name.replace(/\.md$/, "");

    if (opts.format === "markdown") {
      parts.push(body.startsWith("#") ? body : `# ${chapTitle}\n\n${body}`);
      parts.push("\n\n---\n");
    } else if (opts.format === "qidian") {
      parts.push(`${chapTitle}\n\n`);
      parts.push(body.replace(/^#\s*第\d+章[^\n]*\n+/, "") + "\n\n");
    } else if (opts.format === "feilu") {
      parts.push(`### ${chapTitle}\n\n`);
      parts.push(body.replace(/^#\s*第\d+章[^\n]*\n+/, "") + "\n\n");
    } else {
      parts.push(`${chapTitle}\n\n${body.replace(/^#\s*第\d+章[^\n]*\n+/, "")}\n\n\n`);
    }
  }

  const content = parts.join("\n");
  const ext = opts.format === "markdown" ? "md" : "txt";
  const base = `${opts.title || "全书"}_${opts.format}`;
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
    title: opts.title,
    format: opts.format || "qidian",
    chaptersPerVolume: opts.chaptersPerVolume || 30,
  });
}
