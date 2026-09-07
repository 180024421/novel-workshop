import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { confirmAction } from "../lib/confirm";
import {
  applyPackToProject,
  importPackFolder,
  listAllPacks,
  type PackInfo,
} from "../lib/packs";
import { useApp } from "../state/AppContext";

export function PacksPage() {
  const { project, join } = useApp();
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    setPacks(await listAllPacks());
  }

  useEffect(() => {
    void reload();
  }, []);

  async function apply(p: PackInfo) {
    if (!project) {
      setErr("请先打开项目");
      return;
    }
    if (
      !confirmAction(`将把扩展包「${p.name}」的提示词应用到本书，可能覆盖 prompts。确定？`)
    ) {
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await applyPackToProject(p, project.root, join);
      setMsg(`已应用「${p.name}」到当前项目 prompts`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFolder() {
    if (!window.moshu?.pickDirectory) {
      setErr("需要桌面端");
      return;
    }
    const folder = await window.moshu.pickDirectory();
    if (!folder) return;
    const p = await importPackFolder(folder);
    if (!p) {
      setErr("文件夹内缺少有效 pack.json");
      return;
    }
    setPacks((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
    setMsg(`已导入「${p.name}」，可点应用`);
  }

  async function importZip() {
    if (!window.moshu?.importPackZip || !window.moshu.pickFiles) {
      setErr("需要桌面端");
      return;
    }
    setErr("");
    setMsg("");
    const files = await window.moshu.pickFiles({
      title: "选择扩展包 zip",
      filters: [
        { name: "Zip", extensions: ["zip"] },
        { name: "全部", extensions: ["*"] },
      ],
    });
    if (!files.length) return;
    setBusy(true);
    try {
      let r = await window.moshu.importPackZip(files[0], { overwrite: false });
      if (!r.ok && r.needsOverwrite) {
        if (!confirmAction(r.message || "同 id 已存在，是否覆盖？")) {
          setBusy(false);
          return;
        }
        r = await window.moshu.importPackZip(files[0], { overwrite: true });
      }
      if (!r.ok) {
        setErr(r.message || "导入失败");
        return;
      }
      setMsg(r.message);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h2 className="h2">扩展包</h2>
        <p className="muted">
          本地扩展市场：内置题材/禁忌词/导出提示包，一键应用到当前书。不联网。
        </p>
      </div>
      {!project && (
        <div className="panel">
          <p className="muted">打开项目后才能应用扩展包。</p>
          <Link className="btn" to="/">
            回首页
          </Link>
        </div>
      )}
      <div className="panel stack">
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void importFolder()}>
            导入本地包文件夹
          </button>
          <button className="btn" disabled={busy} onClick={() => void importZip()}>
            导入 zip
          </button>
          <button className="btn btn-ghost" onClick={() => void reload()}>
            刷新
          </button>
        </div>
        {msg && <p className="ok-text">{msg}</p>}
        {err && <p className="toast">{err}</p>}
        <div className="stack">
          {packs.map((p) => (
            <div key={p.id + p.dir} className="list-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {p.description}
                    {p.builtin ? " · 内置" : " · 导入"}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={busy || !project}
                  onClick={() => void apply(p)}
                >
                  应用到本书
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
