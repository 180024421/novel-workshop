import { Link, useNavigate } from "react-router-dom";
import { searchInBook, type SearchHit } from "../lib/bookSearch";
import { loadProjectProgress } from "../lib/projectProgress";
import { useApp } from "../state/AppContext";
import { useEffect, useMemo, useState } from "react";

function groupKeyForHit(h: SearchHit, volumeByChapter: Map<string, string>): string {
  const vol = volumeByChapter.get(h.chapterId);
  if (vol) return vol;
  const m = h.chapterId.match(/^(第\d+)/);
  return m?.[1] || h.chapterId.slice(0, 4) || "其它";
}

export function SearchPage() {
  const nav = useNavigate();
  const { project, join, setChapterId, setChapterTitle } = useApp();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [volumeByChapter, setVolumeByChapter] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onHot = (ev: Event) => {
      const d = (ev as CustomEvent<{ action: string }>).detail;
      if (d?.action === "focusSearch") {
        document.getElementById("book-search-input")?.focus();
      }
    };
    window.addEventListener("moshu:hotkey", onHot);
    return () => window.removeEventListener("moshu:hotkey", onHot);
  }, []);

  useEffect(() => {
    if (!project) return;
    void (async () => {
      try {
        const prog = await loadProjectProgress(project.root, join);
        const map = new Map<string, string>();
        for (const r of prog.chapterRows) {
          if (r.volumeId) map.set(r.id, r.volumeId);
        }
        setVolumeByChapter(map);
      } catch {
        setVolumeByChapter(new Map());
      }
    })();
  }, [project, join]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const key = groupKeyForHit(h, volumeByChapter);
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(h);
    }
    return order.map((key) => ({ key, hits: map.get(key)! }));
  }, [hits, volumeByChapter]);

  async function run() {
    if (!project) return;
    if (!q.trim()) {
      setErr("输入要搜的人名、台词或关键词");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      setHits(await searchInBook({ root: project.root, join, query: q.trim() }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openHit(h: SearchHit) {
    try {
      sessionStorage.setItem(
        "moshu.searchJump",
        JSON.stringify({ chapterId: h.chapterId, query: q.trim(), line: h.line })
      );
    } catch {
      /* ignore */
    }
    setChapterId(h.chapterId);
    setChapterTitle(h.chapterTitle || "未命名");
    nav("/app/chapter");
  }

  if (!project) {
    return (
      <div className="panel">
        <Link to="/">回首页</Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h2 className="h2">书内搜索</h2>
        <p className="muted">在已写正文里搜人名、对白、情节关键词。结果按卷分组；点击跳转并高亮。</p>
      </div>
      <div className="panel stack">
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>关键词</label>
            <input
              id="book-search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void run();
              }}
              placeholder="例如：李云龙 / 鬼子 / 通道"
              autoFocus
            />
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={() => void run()}>
            {busy ? "搜索中…" : "搜索"}
          </button>
        </div>
        {err && <p className="toast">{err}</p>}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {hits.length ? `找到 ${hits.length} 处 · ${grouped.length} 组` : "尚无结果"}
        </p>
        <div className="stack" style={{ maxHeight: "60vh", overflow: "auto" }}>
          {grouped.map((g) => (
            <div key={g.key} className="stack" style={{ gap: 6 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
                {g.key}
              </div>
              {g.hits.map((h, i) => (
                <div
                  key={`${h.chapterId}-${h.line}-${i}`}
                  className="list-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => openHit(h)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openHit(h);
                  }}
                >
                  <strong>
                    {h.chapterId} {h.chapterTitle}
                  </strong>
                  <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                    第 {h.line} 行
                  </span>
                  <div style={{ marginTop: 6, fontSize: 14 }}>{h.snippet}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
