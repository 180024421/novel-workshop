import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { backupChapter } from "../lib/backup";
import { loadCharactersMarkdown } from "../lib/characters";
import { chatCompletion, humanizeLlmError } from "../lib/gateway";
import { SYSTEM_WRITER } from "../lib/prompts";
import { syncChapterFileName } from "../lib/chapterFiles";
import {
  extractDialogueLines,
  groupVoiceIssuesByChapter,
  parseVoiceIssues,
  voiceCheckPrompt,
  voiceFixPrompt,
  type VoiceIssue,
} from "../lib/voiceCheck";
import { useApp } from "../state/AppContext";

type ChapterPick = { id: string; title: string; path: string; body: string };

function chapterSortKey(name: string) {
  const n = Number(name.match(/\d+/)?.[0] || 0);
  return n;
}

export function VoiceCheckPage() {
  const { project, join, settings, providers, llmReady, setChapterId, setChapterTitle } = useApp();
  const [chapters, setChapters] = useState<ChapterPick[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [report, setReport] = useState("");
  const [issues, setIssues] = useState<VoiceIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [fixBusy, setFixBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function reload() {
    if (!project || !window.moshu) return;
    const files = await window.moshu.listDir(await join(project.root, "chapters"));
    const md = files
      .filter((f) => f.name.endsWith(".md"))
      .sort((a, b) => chapterSortKey(b.name) - chapterSortKey(a.name));
    const picks: ChapterPick[] = [];
    for (const f of md) {
      if (picks.length >= 8) break;
      const body = await window.moshu.readText(f.path);
      if (!body.trim()) continue;
      const idMatch = f.name.match(/第\d+章/) || f.name.match(/\d+/);
      const id = idMatch ? (String(idMatch[0]).startsWith("第") ? idMatch[0] : `第${idMatch[0]}章`) : f.name;
      const titleLine = body.split(/\r?\n/).find((l) => l.trim()) || "";
      picks.push({
        id,
        title: titleLine.replace(/^#+\s*/, "").slice(0, 40),
        path: f.path,
        body,
      });
    }
    setChapters(picks);
    setSelected(new Set(picks.map((p) => p.id)));
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, join]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runCheck() {
    if (!project) return;
    if (!llmReady) {
      setErr("请先配置模型 Key");
      return;
    }
    const picked = chapters.filter((c) => selected.has(c.id));
    if (!picked.length) {
      setErr("请至少选择一章");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    setReport("");
    setIssues([]);
    try {
      const charactersMarkdown = await loadCharactersMarkdown(project.root, join);
      const names = (charactersMarkdown.match(/^#\s+(.+)$/gm) || [])
        .map((l) => l.replace(/^#\s+/, "").trim())
        .filter((n) => n.length >= 2);
      if (!names.length) {
        setErr("人物卡为空，请先到「人物」页补卡");
        return;
      }
      const samples: { chapterId: string; name: string; lines: string[] }[] = [];
      for (const ch of picked) {
        for (const name of names.slice(0, 12)) {
          const lines = extractDialogueLines(ch.body, name);
          if (lines.length) samples.push({ chapterId: ch.id, name, lines });
        }
      }
      if (!samples.length) {
        setErr("所选章节未抽到对白样本（按人物名+道/说等）");
        return;
      }
      const text = await chatCompletion(
        settings,
        [
          { role: "system", content: SYSTEM_WRITER },
          {
            role: "user",
            content: voiceCheckPrompt({ charactersMarkdown, samples }),
          },
        ],
        { providers, model: settings.routeCheck || settings.routeChapter || "复杂" }
      );
      setReport(text);
      setIssues(parseVoiceIssues(text));
      setMsg(`已检 ${picked.length} 章 · ${names.length} 人 · ${samples.length} 组样本`);
    } catch (e) {
      setErr(humanizeLlmError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runFixDialogue() {
    if (!project || !window.moshu) return;
    if (!llmReady) {
      setErr("请先配置模型 Key");
      return;
    }
    if (!issues.length) {
      setErr("请先体检并解析出问题列表");
      return;
    }
    setFixBusy(true);
    setErr("");
    setMsg("");
    try {
      const charactersMarkdown = await loadCharactersMarkdown(project.root, join);
      const byChapter = groupVoiceIssuesByChapter(issues);
      let fixed = 0;
      const logs: string[] = [];
      for (const [chapterId, chIssues] of byChapter) {
        const pick =
          chapters.find((c) => c.id === chapterId) ||
          chapters.find((c) => chapterId.includes(c.id) || c.id.includes(chapterId));
        if (!pick?.body.trim()) {
          logs.push(`${chapterId}：未找到本地正文，跳过`);
          continue;
        }
        await backupChapter({
          root: project.root,
          join,
          chapterId: pick.id,
          body: pick.body,
          note: "声口改对白前",
        });
        const next = await chatCompletion(
          settings,
          [
            { role: "system", content: SYSTEM_WRITER },
            {
              role: "user",
              content: voiceFixPrompt({
                chapterId: pick.id,
                body: pick.body,
                charactersMarkdown,
                issues: chIssues,
              }),
            },
          ],
          {
            providers,
            model: settings.routeCheck || settings.routeChapter || "复杂",
            maxTokens: 12000,
          }
        );
        if (!next.trim() || next.trim().length < pick.body.trim().length * 0.5) {
          logs.push(`${pick.id}：改写结果过短，已保留原文`);
          continue;
        }
        const title =
          pick.title.replace(/^第\d+章\s*/, "").trim() ||
          next.split(/\r?\n/).find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 40) ||
          "未命名";
        await syncChapterFileName({
          root: project.root,
          join,
          chapterId: pick.id,
          title,
          body: next,
        });
        fixed += 1;
        logs.push(`${pick.id}：已改对白并写回`);
      }
      await reload();
      setMsg(`一键改对白完成：${fixed} 章\n${logs.join("\n")}`);
    } catch (e) {
      setErr(humanizeLlmError(e));
    } finally {
      setFixBusy(false);
    }
  }

  if (!project) {
    return (
      <div className="panel">
        <p className="muted">请先打开书稿。</p>
        <Link className="btn" to="/">
          回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h2 className="h2">声口一致性体检</h2>
        <p className="muted">近章对白对照人物卡；发现问题可一键改对白并写回章节。</p>
      </div>
      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            最近有正文的章节（最多 8）
          </span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-compact" onClick={() => void reload()}>
              刷新
            </button>
            <button
              type="button"
              className="btn btn-primary btn-compact"
              disabled={busy || fixBusy || !chapters.length}
              onClick={() => void runCheck()}
            >
              {busy ? "体检中…" : "开始体检"}
            </button>
            <button
              type="button"
              className="btn btn-compact"
              disabled={busy || fixBusy || !issues.length}
              onClick={() => void runFixDialogue()}
              title="按问题列表改写对应章对白"
            >
              {fixBusy ? "改对白中…" : "一键改对白"}
            </button>
          </div>
        </div>
        {!chapters.length && <p className="muted">暂无有正文的章节。</p>}
        <div className="stack" style={{ gap: 4 }}>
          {chapters.map((c) => (
            <label key={c.id} className="check-row">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                disabled={busy || fixBusy}
              />
              {c.id} · {c.title}
            </label>
          ))}
        </div>
        {msg && (
          <pre className="ok-text" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {msg}
          </pre>
        )}
        {err && <p className="toast">{err}</p>}
        {issues.length > 0 && (
          <div className="scan-box">
            {issues.map((iss, i) => (
              <div key={i} className="scan-hit">
                <strong>{iss.chapterId}</strong> · {iss.name} — {iss.detail}
                <div className="muted" style={{ fontSize: 12 }}>
                  {iss.sample}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  style={{ marginTop: 4 }}
                  onClick={() => {
                    const id = iss.chapterId.startsWith("第")
                      ? iss.chapterId
                      : `第${iss.chapterId.replace(/\D/g, "") || "1"}章`;
                    const ch = chapters.find((c) => c.id === id || c.id === iss.chapterId);
                    setChapterId(ch?.id || id);
                    if (ch?.title) setChapterTitle(ch.title);
                  }}
                >
                  定位到章
                </button>
              </div>
            ))}
          </div>
        )}
        {report && (
          <pre className="stream-box" style={{ maxHeight: 360, whiteSpace: "pre-wrap" }}>
            {report}
          </pre>
        )}
      </div>
    </div>
  );
}
