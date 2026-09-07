import JSZip from "jszip";
import { countTextWords } from "./projectProgress";

export type RichChapter = {
  id: string;
  title: string;
  body: string;
};

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripLeadingHeading(body: string): string {
  return body.replace(/^#\s*第\d+章[^\n]*\n+/, "").trim();
}

/** 纯文本段落 → 简单 XHTML/HTML 段落 */
export function bodyToXhtmlParagraphs(body: string): string {
  const text = stripLeadingHeading(body);
  if (!text) return "<p></p>";
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeXml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function buildEpubBlob(
  title: string,
  chapters: RichChapter[]
): Promise<{ blob: Blob; base64: string; words: number }> {
  const zip = new JSZip();
  // EPUB 要求 mimetype 为首个未压缩条目
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")!.file(
    "container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const oebps = zip.folder("OEBPS")!;
  const safeTitle = escapeXml(title || "全书");
  let words = 0;
  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  const navPoints: string[] = [];

  chapters.forEach((ch, i) => {
    const n = i + 1;
    const fileName = `chap${String(n).padStart(3, "0")}.xhtml`;
    const chapTitle = escapeXml(`${ch.id} ${ch.title}`.trim());
    words += countTextWords(ch.body);
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><title>${chapTitle}</title><meta charset="utf-8"/></head>
<body>
<h1>${chapTitle}</h1>
${bodyToXhtmlParagraphs(ch.body)}
</body>
</html>`;
    oebps.file(fileName, xhtml);
    const id = `chap${n}`;
    manifestItems.push(
      `<item id="${id}" href="${fileName}" media-type="application/xhtml+xml"/>`
    );
    spineItems.push(`<itemref idref="${id}"/>`);
    navPoints.push(
      `<navPoint id="nav${n}" playOrder="${n}"><navLabel><text>${chapTitle}</text></navLabel><content src="${fileName}"/></navPoint>`
    );
  });

  oebps.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="moshu-${Date.now()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${safeTitle}</text></docTitle>
  <navMap>
${navPoints.join("\n")}
  </navMap>
</ncx>`
  );

  oebps.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${safeTitle}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="BookId">moshu-${Date.now()}</dc:identifier>
    <dc:creator>大帅墨枢</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems.join("\n")}
  </manifest>
  <spine toc="ncx">
${spineItems.join("\n")}
  </spine>
</package>`
  );

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });
  const ab = await blob.arrayBuffer();
  return { blob, base64: uint8ToBase64(new Uint8Array(ab)), words };
}

/** 最小 OOXML docx（document.xml + 必需关系） */
export async function buildDocxBlob(
  title: string,
  chapters: RichChapter[]
): Promise<{ blob: Blob; base64: string; words: number }> {
  const zip = new JSZip();
  let words = 0;

  const paras: string[] = [];
  paras.push(
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${escapeXml(title || "全书")}</w:t></w:r></w:p>`
  );

  for (const ch of chapters) {
    words += countTextWords(ch.body);
    const chapTitle = `${ch.id} ${ch.title}`.trim();
    paras.push(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(chapTitle)}</w:t></w:r></w:p>`
    );
    const text = stripLeadingHeading(ch.body);
    for (const block of text.split(/\n{2,}/)) {
      const line = block.trim();
      if (!line) continue;
      paras.push(
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line.replace(/\n/g, " "))}</w:t></w:r></w:p>`
      );
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paras.join("\n")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder("word")!.file("document.xml", documentXml);
  zip.folder("word")!.folder("_rels")!.file(
    "document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`
  );

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
  const ab = await blob.arrayBuffer();
  return { blob, base64: uint8ToBase64(new Uint8Array(ab)), words };
}

export async function loadProjectChapters(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<RichChapter[]> {
  if (!window.moshu) throw new Error("需要桌面端");
  const files = await window.moshu.listDir(await join(root, "chapters"));
  const md = files
    .filter((f) => f.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const out: RichChapter[] = [];
  for (const f of md) {
    const body = (await window.moshu.readText(f.path)).trim();
    if (!body) continue;
    const m = f.name.match(/^(第\d+章)_(.+)\.md$/);
    out.push({
      id: m?.[1] || f.name.replace(/\.md$/, ""),
      title: m?.[2] || "未命名",
      body,
    });
  }
  return out;
}

export async function exportRichBook(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  title: string;
  format: "epub" | "docx";
}): Promise<{ path: string; words: number; chapters: number }> {
  if (!window.moshu) throw new Error("需要桌面端");
  const chapters = await loadProjectChapters(opts.root, opts.join);
  if (!chapters.length) throw new Error("没有可导出的章节正文");

  const built =
    opts.format === "epub"
      ? await buildEpubBlob(opts.title, chapters)
      : await buildDocxBlob(opts.title, chapters);

  const ext = opts.format;
  const base = `${opts.title || "全书"}_${ext}`;
  const outPath = await opts.join(opts.root, "export", `${base}.${ext}`);

  if (window.moshu.writeBinary) {
    await window.moshu.writeBinary(outPath, built.base64);
  }

  let savedPath = outPath;
  if (window.moshu.saveFile) {
    const saved = await window.moshu.saveFile({
      defaultPath: `${base}.${ext}`,
      content: built.base64,
      encoding: "base64",
      filters:
        ext === "epub"
          ? [{ name: "EPUB", extensions: ["epub"] }]
          : [{ name: "Word", extensions: ["docx"] }],
    });
    if (saved) savedPath = saved;
  }

  return { path: savedPath, words: built.words, chapters: chapters.length };
}
