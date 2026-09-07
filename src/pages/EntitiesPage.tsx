import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { confirmAction } from "../lib/confirm";
import {
  deleteEntity,
  emptyEntity,
  loadEntities,
  saveEntity,
  type EntityCard,
  type EntityKind,
} from "../lib/entities";
import { useApp } from "../state/AppContext";

const KINDS: EntityKind[] = ["地点", "势力", "器物", "术语", "其他"];

export function EntitiesPage() {
  const { project, join } = useApp();
  const [list, setList] = useState<EntityCard[]>([]);
  const [cur, setCur] = useState<EntityCard | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function reload() {
    if (!project) return;
    setList(await loadEntities(project.root, join));
  }

  useEffect(() => {
    void reload();
  }, [project]);

  async function saveCard(card: EntityCard) {
    if (!project) return;
    if (!card.name.trim()) {
      setErr("请填写实体名称");
      return;
    }
    setErr("");
    await saveEntity(project.root, join, card);
    setMsg("已保存");
    setCur(card);
    await reload();
  }

  async function deleteCur() {
    if (!cur || !project) return;
    if (!(await confirmAction(`确定删除实体「${cur.name || cur.id}」？`))) return;
    setErr("");
    await deleteEntity(project.root, join, cur);
    setCur(null);
    setMsg("已删除");
    await reload();
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
        <h2 className="h2">实体设定</h2>
        <p className="muted">地点 / 势力 / 器物 / 术语；写章时按正文命中名注入。</p>
      </div>
      <div className="grid-2">
        <div className="panel stack">
          <div className="row">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                setCur(emptyEntity());
                setMsg("");
                setErr("");
              }}
            >
              新建实体
            </button>
          </div>
          {list.map((e) => (
            <div
              key={e.id}
              className="list-card"
              onClick={() => {
                setCur(e);
                setMsg("");
                setErr("");
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") setCur(e);
              }}
            >
              <strong>{e.name || "未命名"}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                [{e.kind}] {e.aliases || "无别名"}
              </div>
            </div>
          ))}
          {!list.length && <p className="muted">还没有实体卡。</p>}
          {msg && <p className="ok-text">{msg}</p>}
          {err && <p className="toast">{err}</p>}
        </div>
        <div className="panel stack">
          {cur ? (
            <>
              <div className="field">
                <label>名称</label>
                <input
                  value={cur.name}
                  onChange={(e) => setCur({ ...cur, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>类型</label>
                <select
                  value={cur.kind}
                  onChange={(e) => setCur({ ...cur, kind: e.target.value as EntityKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>别名（逗号分隔）</label>
                <input
                  value={cur.aliases}
                  onChange={(e) => setCur({ ...cur, aliases: e.target.value })}
                />
              </div>
              <div className="field">
                <label>描述</label>
                <textarea
                  value={cur.description}
                  onChange={(e) => setCur({ ...cur, description: e.target.value })}
                  style={{ minHeight: 100 }}
                />
              </div>
              <div className="field">
                <label>禁忌</label>
                <input
                  value={cur.taboo}
                  onChange={(e) => setCur({ ...cur, taboo: e.target.value })}
                  placeholder="写章时不得违背"
                />
              </div>
              <div className="row">
                <button className="btn btn-primary" type="button" onClick={() => void saveCard(cur)}>
                  保存
                </button>
                <button className="btn btn-danger" type="button" onClick={() => void deleteCur()}>
                  删除
                </button>
              </div>
            </>
          ) : (
            <p className="muted">选择或新建一个实体。</p>
          )}
        </div>
      </div>
    </div>
  );
}
