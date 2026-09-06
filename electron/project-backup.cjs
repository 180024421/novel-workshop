/**
 * 全书 zip 备份 → 用户「下载」目录
 */
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { app, shell } = require("electron");
const JSZip = require("jszip");

const SKIP_DIR = new Set(["node_modules", ".git", ".DS_Store", "revisions"]);

async function walkFiles(dir, base, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIR.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(full, base, out);
    } else if (ent.isFile()) {
      out.push({ full, rel: path.relative(base, full).split(path.sep).join("/") });
    }
  }
}

function sanitize(name) {
  return String(name || "book")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .trim()
    .slice(0, 80);
}

async function zipProjectFolder(root, title) {
  if (!root || !fs.existsSync(root)) {
    return { ok: false, message: "项目目录不存在", filePath: "" };
  }
  const files = [];
  await walkFiles(root, root, files);
  if (!files.length) {
    return { ok: false, message: "项目目录为空", filePath: "" };
  }
  const zip = new JSZip();
  for (const f of files) {
    try {
      const buf = await fsp.readFile(f.full);
      zip.file(f.rel, buf);
    } catch {
      /* skip unreadable */
    }
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const fileName = `${sanitize(title)}-备份-${stamp}.zip`;
  const dest = path.join(app.getPath("downloads"), fileName);
  const content = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await fsp.writeFile(dest, content);
  return {
    ok: true,
    message: `已备份到下载目录：${fileName}`,
    filePath: dest,
    fileCount: files.length,
  };
}

async function openInFolder(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { ok: true };
  }
  return { ok: false };
}

/**
 * 读导入文本：txt/md 直接读；docx 抽纯文本
 */
async function readImportText(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".docx") {
    const buf = await fsp.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    const entry = zip.file("word/document.xml");
    if (!entry) throw new Error("无效的 Word 文档");
    const xml = await entry.async("string");
    const text = xml
      .replace(/<w:tab[^/]*\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br[^/]*\/>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text;
  }
  return fsp.readFile(filePath, "utf8");
}

function chapterSortKey(name) {
  const m = String(name).match(/第(\d+)章/);
  return m ? Number(m[1]) : 0;
}

function formatChapterTxt(fileName, body, format) {
  const m = fileName.match(/^(第\d+章)_(.+)\.md$/);
  const chapTitle = m ? `${m[1]} ${m[2]}` : fileName.replace(/\.md$/, "");
  const cleaned = body.replace(/^#\s*第\d+章[^\n]*\n+/, "").trim();
  if (format === "feilu") return `### ${chapTitle}\n\n${cleaned}\n\n`;
  if (format === "markdown") {
    return (body.startsWith("#") ? body.trim() : `# ${chapTitle}\n\n${cleaned}`) + "\n\n---\n\n";
  }
  return `${chapTitle}\n\n${cleaned}\n\n`;
}

async function exportVolumeZip(opts) {
  const root = opts.root;
  const title = opts.title || "全书";
  const format = opts.format || "qidian";
  const per = Math.max(5, Number(opts.chaptersPerVolume) || 30);
  const chaptersDir = path.join(root, "chapters");
  if (!fs.existsSync(chaptersDir)) {
    return { ok: false, message: "没有 chapters 目录", filePath: "" };
  }
  let names = (await fsp.readdir(chaptersDir)).filter((n) => n.endsWith(".md"));
  names.sort((a, b) => chapterSortKey(a) - chapterSortKey(b) || a.localeCompare(b, "zh"));
  const bodies = [];
  for (const name of names) {
    const text = (await fsp.readFile(path.join(chaptersDir, name), "utf8")).trim();
    if (!text) continue;
    bodies.push({ name, text });
  }
  if (!bodies.length) return { ok: false, message: "没有可导出的正文", filePath: "" };

  const zip = new JSZip();
  let volume = 0;
  for (let i = 0; i < bodies.length; i += per) {
    volume++;
    const slice = bodies.slice(i, i + per);
    const header =
      format === "feilu"
        ? `【书名】${title} · 第${volume}卷\n\n`
        : `${title} · 第${volume}卷\n\n`;
    const content = header + slice.map((c) => formatChapterTxt(c.name, c.text, format)).join("");
    zip.file(`${sanitize(title)}_第${volume}卷.txt`, content);
  }
  // 另附全书单文件，方便整本粘贴
  const all =
    (format === "feilu" ? `【书名】${title}\n\n` : `${title}\n\n`) +
    bodies.map((c) => formatChapterTxt(c.name, c.text, format)).join("");
  zip.file(`${sanitize(title)}_全书.txt`, all);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const fileName = `${sanitize(title)}-分卷导出-${stamp}.zip`;
  const dest = path.join(app.getPath("downloads"), fileName);
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await fsp.writeFile(dest, buf);
  return {
    ok: true,
    message: `已导出 ${volume} 卷 + 全书 TXT → 下载目录`,
    filePath: dest,
    volumes: volume,
  };
}

async function openPath(target) {
  if (!target || !fs.existsSync(target)) return { ok: false, message: "路径不存在" };
  await shell.openPath(target);
  return { ok: true };
}

module.exports = {
  zipProjectFolder,
  openInFolder,
  readImportText,
  exportVolumeZip,
  openPath,
};
