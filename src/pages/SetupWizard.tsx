import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { detectPasteTarget, PROVIDER_PRESETS } from "../lib/providerPresets";
import { useApp } from "../state/AppContext";

const QUICK = ["ModelScope", "DashScope", "Zhipu"] as const;

export function SetupWizard() {
  const nav = useNavigate();
  const { providers, setProviders, llmReady } = useApp();
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [readyLocal, setReadyLocal] = useState(false);

  const quickPresets = useMemo(
    () => PROVIDER_PRESETS.filter((p) => (QUICK as readonly string[]).includes(p.id)),
    []
  );

  async function openSignup(url?: string) {
    if (!url) return;
    if (window.moshu) await window.moshu.openExternal(url);
    else window.open(url, "_blank");
  }

  async function applyAndSave() {
    setErr("");
    setMsg("");
    const hit = detectPasteTarget(paste);
    if (!hit) {
      setErr("没认出 Key 类型。可再试：魔搭 ms- / 千问 sk- / 智谱 id.secret / NVIDIA nvapi-");
      return;
    }
    const next = providers.map((p) =>
      p.id === hit.providerId ? { ...p, apiKey: hit.key, enabled: true } : p
    );
    // 若目标不在列表，忽略
    if (!next.some((p) => p.id === hit.providerId && p.apiKey)) {
      setErr("未找到对应渠道");
      return;
    }
    await setProviders(next);
    setMsg(`已保存到「${hit.providerId}」，可以开始写了`);
    setReadyLocal(true);
  }

  function goWrite() {
    if (!llmReady && !readyLocal && !providers.some((p) => p.enabled && p.apiKey)) {
      setErr("请先粘贴并保存一张 Key");
      return;
    }
    nav("/");
  }

  return (
    <div className="hero-home" data-page="setup">
      <div className="hero-card" style={{ maxWidth: 640 }}>
        <div className="brand-sub">第一步 · 30 秒</div>
        <h1 style={{ fontSize: 42 }}>接入写作引擎</h1>
        <p className="tagline">贴一张免费 API Key 就能写。不用装别的软件。</p>

        <div className="row" style={{ marginTop: 28 }}>
          {quickPresets.map((p) => (
            <button key={p.id} className="btn" type="button" onClick={() => void openSignup(p.signup)}>
              去申请 · {p.name.replace(/魔搭 |千问 |·.*/g, "").trim() || p.name}
            </button>
          ))}
        </div>

        <div className="field" style={{ marginTop: 24 }}>
          <label>把申请到的 Key 整段贴这里</label>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="ms-… / sk-… / nvapi-… / 智谱 id.secret"
            style={{ minHeight: 100 }}
          />
        </div>

        <div className="hero-actions">
          <button className="btn btn-primary" type="button" onClick={() => void applyAndSave()}>
            识别并保存
          </button>
          <button
            className="btn"
            type="button"
            disabled={!llmReady && !readyLocal}
            onClick={goWrite}
          >
            回首页开始
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => nav("/app/settings")}>
            高级设置
          </button>
        </div>

        {msg && <p className="ok-text" style={{ marginTop: 14 }}>{msg}</p>}
        {err && <p className="toast" style={{ marginTop: 14 }}>{err}</p>}
        {llmReady && !msg && (
          <p className="ok-text" style={{ marginTop: 14 }}>已检测到可用 Key，可直接开始写。</p>
        )}
      </div>
    </div>
  );
}
