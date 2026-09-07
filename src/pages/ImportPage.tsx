import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { safeChapterFileTitle } from "../lib/chapterFiles";
import { applyCraftUpgrade } from "../lib/craftUpgrade";
import { GENRE_LABELS, GENRE_PRESETS } from "../lib/genrePresets";
import {
  IMPORT_MAX_BYTES,
  estimateTextBytes,
  mergeManuscriptChapterUp,
  removeManuscriptChapter,
  splitManuscript,
  updateManuscriptChapter,
  type ManuscriptChapter,
} from "../lib/importManuscript";
import { bootstrapVolumeBeatsFromChapters } from "../lib/volumes";
import {
  applyLearnedStyle,
  parseStyleDraft,
  sampleChaptersForStyle,
  styleLearnPrompt,
} from "../lib/styleLearn";
import { chatCompletion } from "../lib/gateway";
import { SYSTEM_WRITER } from "../lib/prompts";
import { confirmAction } from "../lib/confirm";
import { useApp } from "../state/AppContext";

type Step = 1 | 2 | 3 | 4;

export function ImportPage() {
  const nav = useNavigate();
  const { setProject, refreshRecent, setChapterId, setChapterTitle, join, llmReady, settings, providers } =
    useApp();
  const [step, setStep] = useState<Step>(1);
  const [filePath, setFilePath] = useState("");
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [fallbackHint, setFallbackHint] = useState(false);
  const [title, setTitle] = useState("导入书稿");
  const [genre, setGenre] = useState("通用");
  const [customFolder, setCustomFolder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [projectRoot, setProjectRoot] = useState("");
  const [optBootstrap, setOptBootstrap] = useState(true);
  const [optCraft, setOptCraft] = useState(true);
  const [optStyleLearn, setOptStyleLearn] = useState(false);

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
      setProjectRoot(opened.root);
      const first = chapters[0];
      setChapterId(first.id);
      setChapterTitle(first.title);
      await refreshRecent();
      setMsg(`已导入 ${chapters.length} 章 → ${opened.root}`);
      setStep(3);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finishWizard(goPolish: boolean) {
    setErr("");
    setBusy(true);
    try {
      const root = projectRoot;
      if (!root || !window.moshu) {
        setErr("项目未就绪");
        return;
      }
      const notes: string[] = [];
      if (optBootstrap) {
        const r = await bootstrapVolumeBeatsFromChapters({
          root,
          join,
          overwrite: false,
        });
        notes.push(`目录 ${r.chapterCount} 章`);
      }
      if (optCraft) {
        await applyCraftUpgrade(root, join);
        notes.push("已补工艺红线");
      }
      if (optStyleLearn) {
        if (!llmReady) {
          notes.push("文风学习需先配置模型（可到扩展包页补做）");
        } else {
          const samples = await sampleChaptersForStyle(root, join);
          if (samples.length >= 2) {
            const raw = await chatCompletion(
              settings,
              [
                { role: "system", content: SYSTEM_WRITER },
                { role: "user", content: styleLearnPrompt({ samples }) },
              ],
              { providers, temperature: 0.4 }
            );
            const { styleMd } = parseStyleDraft(raw);
            if (
              styleMd &&
              (await confirmAction(
                `已生成文风卡草稿（约 ${styleMd.replace(/\s+/g, "").length} 字），合并进 prompts/style.md？`
              ))
            ) {
              await applyLearnedStyle({ root, join, styleMd });
              notes.push("已学文风并合并");
            } else {
              notes.push("已生成文风草稿但未合并");
            }
          } else {
            notes.push("正文样本不足，跳过学文风");
          }
        }
      }
      setMsg(notes.length ? `已处理：${notes.join(" · ")}` : "已跳过结构落地");
      setStep(4);
      if (goPolish) {
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
        <p className="muted">导入后可增卷增章、AI 润色。不自动生成总纲与人物卡。</p>

        <div className="steps" style={{ marginBottom: 16 }}>
          <span className={`step-pill ${step >= 1 ? "on" : ""}`}>1 选文件</span>
          <span className={`step-pill ${step >= 2 ? "on" : ""}`}>2 预览</span>
          <span className={`step-pill ${step >= 3 ? "on" : ""}`}>3 落地</span>
          <span className={`step-pill ${step >= 4 ? "on" : ""}`}>4 完成</span>
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
                导入建书不依赖引擎；润色请先 <Link to="/setup">配置引擎</Link>。
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
                未识别到章标题，已整篇作为「第1章_导入」。可在下方删改；或导入后手动拆章。
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

            <div className="muted">预览 {chapters.length} 章（可改标题 / 合并 / 删除）</div>
            <div className="stack" style={{ maxHeight: 320, overflow: "auto", gap: 8 }}>
              {chapters.map((c, i) => (
                <div key={`${c.id}-${i}`} className="list-card stack" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <strong style={{ minWidth: 56 }}>{c.id}</strong>
                    <input
                      value={c.title}
                      onChange={(e) =>
                        setChapters((prev) => updateManuscriptChapter(prev, i, { title: e.target.value }))
                      }
                      style={{ flex: 1, minWidth: 120 }}
                      aria-label={`${c.id} 标题`}
                    />
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {c.body.slice(0, 100).replace(/\s+/g, " ") || "（空）"}
                    {c.body.length > 100 ? "…" : ""}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={i === 0}
                      onClick={() => setChapters((prev) => mergeManuscriptChapterUp(prev, i))}
                    >
                      合并到上一章
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={chapters.length <= 1}
                      onClick={() => setChapters((prev) => removeManuscriptChapter(prev, i, true))}
                    >
                      删除
                    </button>
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
            <p className="ok-text">{msg || "章节已写入"}</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              推荐：补结构 + 工艺红线后，进第 1 章扫描 → 工艺润色 → Diff。
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={optBootstrap}
                onChange={(e) => setOptBootstrap(e.target.checked)}
              />
              <span>从已导入章节生成第1卷细纲目录</span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={optCraft} onChange={(e) => setOptCraft(e.target.checked)} />
              <span>一键补工艺红线到 style / taboo</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={optStyleLearn}
                onChange={(e) => setOptStyleLearn(e.target.checked)}
              />
              <span>学我的文风（抽样正文生成 style.md，确认后合并）</span>
            </label>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => void finishWizard(true)}
              >
                {busy ? "处理中…" : "补结构并去第1章润色"}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => void finishWizard(false)}
              >
                仅落地结构
              </button>
              <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => nav("/app/chapter")}>
                跳过，直接打开
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="panel stack">
            <p className="ok-text">{msg || "导入完成"}</p>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              下一步：正文工具「扫描 → 工艺润色」；需要加章时侧栏或卷章管理点「+新建章」。
            </p>
            <div className="row">
              <button className="btn btn-primary" type="button" onClick={() => nav("/app/chapter")}>
                打开第1章润色
              </button>
              <button className="btn" type="button" onClick={() => nav("/app/volumes")}>
                卷章管理
              </button>
              <Link className="btn btn-ghost" to="/">
                回首页
              </Link>
            </div>
          </div>
        )}

        {err && <p className="toast">{err}</p>}
        {msg && step === 2 && <p className="ok-text">{msg}</p>}
      </div>
    </div>
  );
}
