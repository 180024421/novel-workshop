import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { writeOneChapter } from "../lib/chapterWrite";
import { isAbortError } from "../lib/confirm";
import { estimateCostCny, formatCny, loadPrices, pickPrice } from "../lib/costEstimate";
import { GENRE_LABELS, GENRE_PRESETS } from "../lib/genrePresets";
import { chatCompletion, humanizeLlmError } from "../lib/gateway";
import {
  expandIdeaPrompt,
  generateSystemPrompt,
  outlinePrompt,
  parseChapterList,
  volumeBeatsPrompt,
} from "../lib/prompts";
import { useApp } from "../state/AppContext";

type Step = 1 | 2 | 3;

export function QuickStartPage() {
  const nav = useNavigate();
  const {
    llmReady,
    bootstrapped,
    settings,
    providers,
    setProject,
    refreshRecent,
    join,
    setChapterId,
    setChapterTitle,
    setVolumeId,
  } = useApp();
  const [step, setStep] = useState<Step>(1);
  const [seed, setSeed] = useState("");
  const [title, setTitle] = useState("一句话开书");
  const [genre, setGenre] = useState("通用");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");
  const [hasPartial, setHasPartial] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (bootstrapped && !llmReady) nav("/setup");
  }, [bootstrapped, llmReady, nav]);

  function cancelRun() {
    abortRef.current?.abort();
  }

  async function runGenerate() {
    setErr("");
    setHasPartial(false);
    if (!llmReady) {
      nav("/setup");
      return;
    }
    if (!window.moshu) {
      setErr("请用桌面端打开");
      return;
    }
    if (!seed.trim()) {
      setErr("先写一句话种子");
      setStep(1);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const signal = ac.signal;

    setBusy(true);
    setStatus("正在估算费用…");
    try {
      const prices = await loadPrices(join);
      const enabled = providers.find((p) => p.enabled && p.apiKey.trim());
      const price = pickPrice(prices, enabled?.id);
      // 4 步：设定 / 总纲 / 细纲 / 第1章，粗估 token
      const est = estimateCostCny(4000 * 4, 2500 * 4, price.cnyPer1k);
      setStatus(`粗估约 ${formatCny(est)}（${price.label}，4 步）· 正在创建项目…`);

      const preset = GENRE_PRESETS.find((g) => g.label === genre) || GENRE_PRESETS[0];
      const opened = await window.moshu.createProjectDefault({
        title: title.trim() || "一句话开书",
        genre,
      });
      await window.moshu.writeText(
        await window.moshu.joinPath(opened.root, "prompts", "style.md"),
        preset.style
      );
      setProject(opened);
      setHasPartial(true);
      await refreshRecent();

      const root = opened.root;
      const seedPath = await join(root, "ideas", "seed.md");
      await window.moshu.writeText(seedPath, seed.trim());

      setStatus(`粗估约 ${formatCny(est)} · 正在生成设定…`);
      const bible = await chatCompletion(
        settings,
        [
          { role: "system", content: generateSystemPrompt("idea") },
          { role: "user", content: expandIdeaPrompt(seed, preset.style) },
        ],
        { model: settings.routeOutline || "复杂", providers, stream: false, signal }
      );
      await window.moshu.writeText(await join(root, "bible", "world.md"), bible);

      setStatus(`粗估约 ${formatCny(est)} · 正在生成总纲…`);
      const outline = await chatCompletion(
        settings,
        [
          { role: "system", content: generateSystemPrompt("outline") },
          {
            role: "user",
            content: outlinePrompt(
              bible,
              seed,
              `题材：${preset.label}。${preset.outlineHint || ""} 一句话开书，结构从简。`
            ),
          },
        ],
        { model: settings.routeOutline || "复杂", providers, stream: false, signal }
      );
      await window.moshu.writeText(await join(root, "outlines", "outline.md"), outline);

      setStatus(`粗估约 ${formatCny(est)} · 正在生成第1卷细纲（约 8～12 章）…`);
      const beats = await chatCompletion(
        settings,
        [
          { role: "system", content: generateSystemPrompt("beats") },
          {
            role: "user",
            content: volumeBeatsPrompt({
              outline,
              volumeId: "第1卷",
              volumeTitle: "开篇",
              chapters: [],
              bible,
              style: preset.style,
              kb: "",
              chaptersPerVolume: 10,
            }),
          },
        ],
        { model: settings.routeOutline || "复杂", providers, stream: false, signal }
      );
      await window.moshu.writeText(await join(root, "beats", "第1卷.md"), beats);

      const chapters = parseChapterList(beats);
      const first = chapters[0] || { id: "第1章", title: "开端", blurb: "" };
      setVolumeId("第1卷");
      setChapterId(first.id);
      setChapterTitle(first.title || "开端");

      setStatus(`粗估约 ${formatCny(est)} · 正在写 ${first.id} 正文…`);
      await writeOneChapter({
        root,
        join,
        chapterId: first.id,
        chapterTitle: first.title || "开端",
        settings,
        providers,
        targetWords: settings.defaultChapterWords ?? 2500,
        extractHooks: false,
        signal,
      });

      setStatus("完成");
      setHasPartial(false);
      await refreshRecent();
      nav("/app/chapter");
    } catch (e) {
      if (isAbortError(e)) {
        setStatus("已取消");
        setErr("");
      } else {
        setErr(
          `${humanizeLlmError(e)}。已写入的内容会保留，可打开半成品继续。`
        );
        setStatus("已中断；已写入的文件会保留");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`hero-home tone-ink`} data-page="quick-start">
      <div className="hero-card panel" style={{ maxWidth: 560, width: "100%" }}>
        <p className="muted">
          <Link to="/">← 回首页</Link>
        </p>
        <h1 className="h2">一句话开书</h1>
        <p className="muted">种子 → 确认书名 → 一键生成设定、总纲、卷1细纲与第1章</p>

        <div className="stack" style={{ marginTop: 16 }}>
          {step === 1 && (
            <>
              <div className="field">
                <label>故事种子（一句话或一小段）</label>
                <textarea
                  rows={5}
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="例：废柴少年捡到一把会说话的锈刀，被迫卷入王朝秘辛…"
                  disabled={busy}
                  style={{ minHeight: 120, width: "100%" }}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !seed.trim()}
                onClick={() => {
                  if (!llmReady) {
                    nav("/setup");
                    return;
                  }
                  const guess = seed.trim().slice(0, 16).replace(/\s+/g, "") || "一句话开书";
                  if (title === "一句话开书" || !title.trim()) setTitle(guess);
                  setStep(2);
                }}
              >
                下一步
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="field">
                <label>书名</label>
                <input
                  className="home-new-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="field">
                <label>题材</label>
                <select
                  className="home-new-genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  disabled={busy}
                >
                  {GENRE_LABELS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn" disabled={busy} onClick={() => setStep(1)}>
                  上一步
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => setStep(3)}
                >
                  确认，准备生成
                </button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <p>
                《{title || "未命名"}》· {genre}
              </p>
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                {seed.slice(0, 400)}
                {seed.length > 400 ? "…" : ""}
              </p>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn" disabled={busy} onClick={() => setStep(2)}>
                  上一步
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void runGenerate()}
                >
                  {busy ? "生成中…" : "一键生成到第1章"}
                </button>
                {busy && (
                  <button type="button" className="btn" onClick={cancelRun}>
                    取消
                  </button>
                )}
              </div>
              {status && <p className="muted">{status}</p>}
            </>
          )}

          {err && (
            <div className="stack" style={{ gap: 8 }}>
              <p className="toast">{err}</p>
              {hasPartial && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => nav("/app/idea")}
                >
                  打开半成品
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
