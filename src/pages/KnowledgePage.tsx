import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyGuide } from "../components/EmptyGuide";
import { confirmAction } from "../lib/confirm";
import { chunkText, KB_TAG_OPTIONS, kbEmbeddingApiReady, retrieveChunks } from "../lib/kb";
import type { KbChunk } from "../types";
import { useApp } from "../state/AppContext";

const PAGE_SIZE = 40;

export function KnowledgePage() {
  const { project, join, settings, providers } = useApp();
  const [chunks, setChunks] = useState<KbChunk[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KbChunk[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [importTags, setImportTags] = useState<string[]>(["节奏"]);
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  async function loadIndex() {
    if (!project || !window.moshu) return;
    const idx = await window.moshu.readJson<{ chunks: KbChunk[] }>(
      await join(project.root, "kb", "index.json"),
      { chunks: [] }
    );
    setChunks(idx.chunks || []);
  }

  useEffect(() => {
    void loadIndex();
  }, [project]);

  async function persist(next: KbChunk[]) {
    if (!project || !window.moshu) return;
    await window.moshu.writeJson(await join(project.root, "kb", "index.json"), {
      chunks: next,
      updatedAt: new Date().toISOString(),
    });
    setChunks(next);
  }

  async function importFiles() {
    if (!project || !window.moshu) return;
    setErr("");
    setMsg("");
    const files = await window.moshu.pickFiles({
      title: "导入范文 / 参考资料",
      filters: [
        { name: "文本与 Word", extensions: ["txt", "md", "markdown", "docx"] },
        { name: "全部", extensions: ["*"] },
      ],
    });
    if (!files.length) return;
    const next = [...chunks];
    for (const fp of files) {
      let text = "";
      try {
        text = window.moshu.readImportText
          ? await window.moshu.readImportText(fp)
          : await window.moshu.readText(fp);
      } catch (e) {
        setErr(e instanceof Error ? e.message : `无法读取 ${fp}`);
        continue;
      }
      if (!text.trim()) continue;
      const name = fp.split(/[/\\]/).pop() || "ref";
      const destName = name.replace(/\.docx$/i, ".txt");
      const dest = await join(project.root, "refs", destName);
      await window.moshu.writeText(dest, text);
      next.push(...chunkText(destName, text, importTags.length ? importTags : ["范文"]));
    }
    await persist(next);
    setMsg(`已导入并切片，共 ${next.length} 段`);
  }

  function toggleImportTag(tag: string) {
    setImportTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function toggleSearchTag(tag: string) {
    setSearchTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function patchChunkTags(id: string, tag: string) {
    const next = chunks.map((c) => {
      if (c.id !== id) return c;
      const tags = c.tags.includes(tag)
        ? c.tags.filter((t) => t !== tag)
        : [...c.tags, tag];
      return { ...c, tags };
    });
    await persist(next);
  }

  async function deleteChunk(id: string, source: string) {
    if (!confirmAction(`确定删除切片「${source}」？\n此操作会从知识库移除该段。`)) return;
    const next = chunks.filter((c) => c.id !== id);
    await persist(next);
    setHits((prev) => prev.filter((h) => h.id !== id));
    setMsg("已删除切片");
  }

  async function search() {
    setHits(retrieveChunks(chunks, query, 6, searchTags));
  }

  if (!project) {
    return (
      <div className="panel">
        <Link to="/">回首页</Link>
      </div>
    );
  }

  const visible = chunks.slice(0, visibleCount);
  const hasMore = chunks.length > visibleCount;

  return (
    <div className="stack">
      <div>
        <h2 className="h2">范文知识库</h2>
        <p className="muted">按标签（节奏/对白/战斗…）导入 TXT / Markdown / Word(.docx)；写作时会按细纲偏好加权检索。</p>
        {settings.kbEmbeddingEnabled ? (
          <p className="muted" style={{ fontSize: 12 }}>
            {kbEmbeddingApiReady(providers)
              ? "Embedding 已开启：写章检索会先 MiniSearch 再向量重排；失败自动回退。"
              : "Embedding 已开启，但当前无可用渠道 Key，检索仍使用 MiniSearch。"}
          </p>
        ) : null}
      </div>

      {chunks.length === 0 && (
        <EmptyGuide
          title="还没有范文"
          steps={[
            "导入 TXT / Markdown / Word 范文，自动切片入库",
            "给切片打上节奏/对白/战斗等标签，方便检索",
            "写作时按细纲偏好加权召回，帮你贴近目标文风",
          ]}
        />
      )}

      <div className="panel stack">
        <div className="muted" style={{ fontSize: 13 }}>
          导入时标签
        </div>
        <div className="chip-row">
          {KB_TAG_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip ${importTags.includes(t) ? "on" : ""}`}
              onClick={() => toggleImportTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => void importFiles()}>
            导入范文
          </button>
          <span className="muted">当前切片：{chunks.length}</span>
        </div>
        {msg && <p className="ok-text">{msg}</p>}
        {err && <p className="toast">{err}</p>}
        <div className="muted" style={{ fontSize: 13 }}>
          检索标签（可选过滤）
        </div>
        <div className="chip-row">
          {KB_TAG_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip ${searchTags.includes(t) ? "on" : ""}`}
              onClick={() => toggleSearchTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="field">
          <label>试检索</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="战斗 / 对白 / 环境…" />
        </div>
        <button className="btn" onClick={() => void search()}>
          检索
        </button>
        {hits.map((h) => (
          <div key={h.id} className="stream-box" style={{ minHeight: 60, maxHeight: 140 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              {h.source} · {(h.tags || []).join(" / ")}
            </div>
            {h.text.slice(0, 280)}
          </div>
        ))}
      </div>
      {chunks.length > 0 && (
        <div className="panel stack">
          <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>切片标签（可点改）</h3>
          <div className="stack" style={{ maxHeight: 360, overflow: "auto" }}>
            {visible.map((c) => (
              <div key={c.id} className="list-card">
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {c.source} · {c.id}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-compact"
                    onClick={() => void deleteChunk(c.id, c.source)}
                  >
                    删除
                  </button>
                </div>
                <div className="chip-row" style={{ marginTop: 8 }}>
                  {KB_TAG_OPTIONS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`chip ${(c.tags || []).includes(t) ? "on" : ""}`}
                      onClick={() => void patchChunkTags(c.id, t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 13, marginTop: 6 }}>{c.text.slice(0, 120)}…</div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              className="btn"
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            >
              再显示 40
            </button>
          )}
        </div>
      )}
    </div>
  );
}
