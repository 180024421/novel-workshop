import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  characterToMarkdown,
  parseCharactersJson,
  saveCharacterCards,
} from "../lib/characters";
import { findCharacterConflicts, type CharacterConflict } from "../lib/characterConflicts";
import { confirmAction, confirmOverwrite } from "../lib/confirm";
import { chatCompletion, humanizeLlmError } from "../lib/gateway";
import { extractCharactersPrompt, SYSTEM_WRITER } from "../lib/prompts";
import type { CharacterCard } from "../types";
import { useApp } from "../state/AppContext";

const empty = (): CharacterCard => ({
  id: `char_${Date.now()}`,
  name: "",
  role: "",
  voice: "",
  traits: "",
  relationships: "",
  taboo: "",
  arc: "",
});

const TEXT_FIELDS = [
  "name",
  "role",
  "voice",
  "traits",
  "relationships",
  "taboo",
  "arc",
] as const;

function toMarkdown(c: CharacterCard) {
  return characterToMarkdown(c);
}

function mergeField(target: string, source: string): string {
  const t = (target || "").trim();
  const s = (source || "").trim();
  if (!t) return s;
  if (!s) return t;
  if (t === s) return t;
  return `${t}；${s}`;
}

function mergeCards(target: CharacterCard, source: CharacterCard): CharacterCard {
  const next: CharacterCard = { ...target };
  for (const k of TEXT_FIELDS) {
    if (k === "name") {
      const t = (target.name || "").trim();
      const s = (source.name || "").trim();
      next.name = t || s;
    } else {
      next[k] = mergeField(target[k], source[k]);
    }
  }
  return next;
}

function fileBase(card: CharacterCard) {
  return card.name || card.id;
}

export function CharactersPage() {
  const nav = useNavigate();
  const { project, join, settings, providers, llmReady } = useApp();
  const [list, setList] = useState<CharacterCard[]>([]);
  const [cur, setCur] = useState<CharacterCard | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<CharacterConflict[]>([]);

  async function reload() {
    if (!project || !window.moshu) return;
    const files = await window.moshu.listDir(await join(project.root, "characters"));
    const cards: CharacterCard[] = [];
    for (const f of files) {
      if (!f.name.endsWith(".json")) continue;
      const c = await window.moshu.readJson<CharacterCard | null>(f.path, null);
      if (c) cards.push(c);
    }
    setList(cards);
  }

  useEffect(() => {
    void reload();
  }, [project]);

  async function deleteCharacterFiles(card: CharacterCard) {
    if (!project || !window.moshu?.deletePath) return;
    const base = fileBase(card);
    await window.moshu.deletePath(await join(project.root, "characters", `${base}.json`));
    await window.moshu.deletePath(await join(project.root, "characters", `${base}.md`));
  }

  async function saveCard(card: CharacterCard) {
    if (!project || !window.moshu) return;
    const base = fileBase(card);
    await window.moshu.writeJson(await join(project.root, "characters", `${base}.json`), card);
    await window.moshu.writeText(
      await join(project.root, "characters", `${base}.md`),
      toMarkdown(card)
    );
    setMsg("已保存");
    await reload();
  }

  async function deleteCur() {
    if (!cur || !project || !window.moshu) return;
    if (!(await confirmAction(`确定删除人物「${cur.name || cur.id}」？`))) return;
    setErr("");
    await deleteCharacterFiles(cur);
    setCur(null);
    setMergeTargetId("");
    setMsg("已删除");
    await reload();
  }

  async function mergeCurInto() {
    if (!cur || !project || !window.moshu || !mergeTargetId) return;
    const target = list.find((c) => c.id === mergeTargetId);
    if (!target || target.id === cur.id) return;
    if (
      !(await confirmAction(
        `将「${cur.name || cur.id}」合并到「${target.name || target.id}」并删除源人物？`
      ))
    ) {
      return;
    }
    setErr("");
    const merged = mergeCards(target, cur);
    await deleteCharacterFiles(cur);
    await saveCard(merged);
    setCur(merged);
    setMergeTargetId("");
    setMsg(`已合并到「${merged.name || merged.id}」`);
    await reload();
  }

  async function extractFromBible() {
    if (!project || !window.moshu) return;
    if (!llmReady) {
      nav("/setup");
      return;
    }
    const bible = await window.moshu.readText(await join(project.root, "bible", "world.md"));
    if (!bible.trim()) {
      setErr("设定还是空的，请先在设定页生成设定/总纲");
      return;
    }
    if (list.length && !(await confirmOverwrite("人物卡（按设定重新抽取）"))) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const raw = await chatCompletion(
        settings,
        [
          { role: "system", content: SYSTEM_WRITER },
          { role: "user", content: extractCharactersPrompt(bible) },
        ],
        { model: settings.routeOutline || "复杂", providers, stream: false }
      );
      const cards = parseCharactersJson(raw);
      if (!cards.length) {
        setErr("未能解析出人物，请检查设定里是否有「主要人物」");
        return;
      }
      const issues = findCharacterConflicts(list, cards);
      setConflicts(issues);
      await saveCharacterCards(project.root, join, cards);
      const errN = issues.filter((x) => x.level === "error").length;
      const warnN = issues.filter((x) => x.level === "warn").length;
      setMsg(
        `已抽出 ${cards.length} 人` +
          (errN || warnN ? ` · 发现 ${errN} 处冲突 / ${warnN} 条提示` : "")
      );
      await reload();
    } catch (e) {
      setErr(humanizeLlmError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!project) {
    return (
      <div className="panel">
        <Link to="/">回首页</Link>
      </div>
    );
  }

  const mergeOptions = cur ? list.filter((c) => c.id !== cur.id) : [];

  return (
    <div className="stack">
      <div>
        <h2 className="h2">人物卡</h2>
        <p className="muted">维护角色声口与关系；写正文时会自动注入。</p>
      </div>
      <div className="grid-2">
        <div className="panel stack">
          <div className="row">
            <button
              className="btn btn-primary"
              onClick={() => {
                const c = empty();
                setCur(c);
                setMergeTargetId("");
              }}
            >
              新建人物
            </button>
            <button className="btn" disabled={busy} onClick={() => void extractFromBible()}>
              {busy ? "抽取中…" : "从设定抽取"}
            </button>
          </div>
          {list.map((c) => (
            <div
              key={c.id}
              className="list-card"
              onClick={() => {
                setCur(c);
                setMergeTargetId("");
              }}
              role="button"
              tabIndex={0}
            >
              <strong>{c.name || "未命名"}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {c.role || "未填身份"}
              </div>
            </div>
          ))}
          {msg && <p className="ok-text">{msg}</p>}
          {err && <p className="toast">{err}</p>}
          {conflicts.length > 0 && (
            <div className="conflict-box">
              <strong>人物冲突 / 提示</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {conflicts.map((c, i) => (
                  <li key={i} className={c.level === "error" ? "conflict-error" : "conflict-warn"}>
                    {c.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="panel stack">
          {cur ? (
            <>
              {(
                [
                  ["name", "姓名"],
                  ["role", "身份"],
                  ["voice", "声口"],
                  ["traits", "性格"],
                  ["relationships", "关系"],
                  ["taboo", "禁忌"],
                  ["arc", "成长弧"],
                ] as const
              ).map(([k, label]) => (
                <div className="field" key={k}>
                  <label>{label}</label>
                  {k === "traits" || k === "relationships" || k === "arc" ? (
                    <textarea
                      value={cur[k]}
                      onChange={(e) => setCur({ ...cur, [k]: e.target.value })}
                      style={{ minHeight: 80 }}
                    />
                  ) : (
                    <input
                      value={cur[k]}
                      onChange={(e) => setCur({ ...cur, [k]: e.target.value })}
                    />
                  )}
                </div>
              ))}
              <div className="row">
                <button className="btn btn-primary" onClick={() => void saveCard(cur)}>
                  保存人物卡
                </button>
                <button className="btn btn-danger" type="button" onClick={() => void deleteCur()}>
                  删除
                </button>
              </div>
              {mergeOptions.length > 0 && (
                <div className="row" style={{ alignItems: "flex-end" }}>
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label>合并到…</label>
                    <select
                      value={mergeTargetId}
                      onChange={(e) => setMergeTargetId(e.target.value)}
                    >
                      <option value="">选择目标人物</option>
                      {mergeOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="btn"
                    type="button"
                    disabled={!mergeTargetId}
                    onClick={() => void mergeCurInto()}
                  >
                    确认合并
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="muted">选择或新建一个人物。</p>
          )}
        </div>
      </div>
    </div>
  );
}
