import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { safeChapterFileTitle } from "../lib/chapterFiles";
import { GENRE_LABELS, GENRE_PRESETS } from "../lib/genrePresets";
import {
  IMPORT_MAX_BYTES,
  estimateTextBytes,
  splitManuscript,
  type ManuscriptChapter,
} from "../lib/importManuscript";
import { useApp } from "../state/AppContext";

type Step = 1 | 2 | 3;

export function ImportPage() {
  const nav = useNavigate();
  const { setProject, refreshRecent, setChapterId, setChapterTitle, llmReady } = useApp();
  const [step, setStep] = useState<Step>(1);
  const [filePath, setFilePath] = useState("");
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [fallbackHint, setFallbackHint] = useState(false);
  const [title, setTitle] = useState("导入书稿");
  const [genre, setGenre] = useState("通用");
  const [customFolder, setCustomFolder] = useState(false);
  const [openStudio, setOpenStudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function pickManuscript() {
    setErr("");
    setMsg("");
    if (!window.moshu) {
      setErr("请用桌面端打开");
      return;
    }
    const files = await window.moshu.pickFiles({
      title: "选择书稿 TXT / MD",
      filters: [
        { name: "文本", extensions: ["txt", "md", "markdown"] },
        { name: "全部", extensions: ["*"] },
      ],
    });
    if (!files.length) return;
    const fp = files[0];
    setBusy(true);
    try {
      const text = window.moshu.readImportText
        ? await window.moshu.readImportText(fp)
        : await window.moshu.readText(fp);
      if (estimateTextBytes(text) > IMPORT_MAX_BYTES) {
        setErr("文件过大（>20MB），请先拆分成多个文件再导入");
        return;
      }
      const parts = splitManuscript(text);
      const isFallback =
        parts.length === 1 && parts[0].title === "导入" && !/第\s*\d+\s*章|Chapter\s+\d+/i.test(text);
      setChapters(parts);
      setFallbackHint(isFallback);
      setFilePath(fp);
      const base = fp.split(/[/\\]/).pop()?.replace(/\.(txt|md|markdown)$/i, "") || "导入书稿";
      setTitle(base);
      setStep(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createBook() {
    setErr("");
    setMsg("");
    if (!window.moshu) {
      setErr("请用桌面端打开");
      return;
    }
    if (!chapters.length) {
      setErr("没有可写入的章节");
      return;
    }
    setBusy(true);
    try {
      const preset = GENRE_PRESETS.find((g) => g.label === genre) || GENRE_PRESETS[0];
      let opened;
      if (customFolder) {
        const folder = await window.moshu.pickFolder();
        if (!folder) {
          setBusy(false);
          return;
        }
        opened = await window.moshu.createProject({
          folder,
          title: title.trim() || "导入书稿",
          genre,
        });
      } else {
        opened = await window.moshu.createProjectDefault({
          title: title.trim() || "导入书稿",
          genre,
        });
      }
      await window.moshu.writeText(
        await window.moshu.joinPath(opened.root, "prompts", "style.md"),
        preset.style
      );

      const chaptersDir = await window.moshu.joinPath(opened.root, "chapters");
      for (const ch of chapters) {
        const fileName = `${ch.id}_${safeChapterFileTitle(ch.title)}.md`;
        const path = await window.moshu.joinPath(chaptersDir, fileName);
        const body = ch.body.trim()
          ? ch.body.startsWith("#")
            ? ch.body
            : `# ${ch.id} ${ch.title}\n\n${ch.body}`
          : `# ${ch.id} ${ch.title}\n\n`;
        await window.moshu.writeText(path, body);
      }

      setProject(opened);
      const first = chapters[0];
      setChapterId(first.id);
      setChapterTitle(first.title);
      await refreshRecent();
      setMsg(`已导入 ${chapters.length} 章 → ${opened.root}`);
      setStep(3);
      if (openStudio) {
        nav("/app/chapter");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`hero-home tone-ink`} data-page="import">
      <div className="hero-card" style={{ maxWidth: 720, width: "100%" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="brand-sub">IMPORT</div>
            <h1 style={{ margin: "4px 0 0", fontSize: 28 }}>导入书稿</h1>
          </div>
          <Link className="btn btn-ghost" to="/">
            回首页
          </Link>
        </div>
        <p className="muted">从 TXT / MD 拆章建书。不自动生成总纲与人物卡。</p>

        <div className="steps" style={{ marginBottom: 16 }}>
          <span className={`step-pill ${step >= 1 ? "on" : ""}`}>1 选文件</span>
          <span className={`step-pill ${step >= 2 ? "on" : ""}`}>2 预览</span>
          <span className={`step-pill ${step >= 3 ? "on" : ""}`}>3 完成</span>
        </div>

        {step === 1 && (
          <div className="panel stack">
            <p className="muted" style={{ margin: 0 }}>
              支持行首「第N章」「Chapter N」「# 第N章」。无法识别时整篇作为「第1章_导入」。
            </p>
            <button className="btn btn-primary" disabled={busy} onClick={() => void pickManuscript()}>
              {busy ? "读取中…" : "选择 TXT / MD"}
            </button>
            {!llmReady && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                导入建书不依赖引擎；后续写章请先{" "}
                <Link to="/setup">配置引擎</Link>。
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="panel stack">
            <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
              {filePath}
            </div>
            {fallbackHint && (
              <p className="toast" style={{ margin: 0 }}>
                未识别到章标题，已整篇作为「第1章_导入」。可稍后在 Studio 手动拆章。
              </p>
            )}
            <div className="field">
              <label>书名</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label>题材</label>
              <select value={genre} onChange={(e) => setGenre(e.target.value)}>
                {GENRE_LABELS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={customFolder}
                onChange={(e) => setCustomFolder(e.target.checked)}
              />
              <span>自选项目文件夹（默认：文档/大帅墨枢）</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={openStudio}
                onChange={(e) => setOpenStudio(e.target.checked)}
              />
              <span>导入后打开 Studio</span>
            </label>

            <div className="muted">预览 {chapters.length} 章</div>
            <div className="stack" style={{ maxHeight: 280, overflow: "auto" }}>
              {chapters.map((c) => (
                <div key={c.id + c.title} className="list-card">
                  <strong>
                    {c.id}_{c.title}
                  </strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {c.body.slice(0, 80).replace(/\s+/g, " ") || "（空）"}
                    {c.body.length > 80 ? "…" : ""}
                  </div>
                </div>
              ))}
            </div>

            <div className="row">
              <button className="btn" type="button" disabled={busy} onClick={() => setStep(1)}>
                重选文件
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void createBook()}>
                {busy ? "创建中…" : "创建项目并写入章节"}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="panel stack">
            <p className="ok-text">{msg || "导入完成"}</p>
            <div className="row">
              <button className="btn btn-primary" type="button" onClick={() => nav("/app/chapter")}>
                打开 Studio
              </button>
              <Link className="btn" to="/">
                回首页
              </Link>
            </div>
          </div>
        )}

        {err && <p className="toast">{err}</p>}
        {msg && step !== 3 && <p className="ok-text">{msg}</p>}
      </div>
    </div>
  );
}
