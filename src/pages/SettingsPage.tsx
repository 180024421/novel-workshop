import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  defaultProviders,
  detectPasteTarget,
  type ProviderConfig,
} from "../lib/providerPresets";
import type { AppSettings } from "../types";
import {
  EDITOR_THEME_IDS,
  EDITOR_THEME_PRESETS,
  resolveEditorColors,
  resolveSidebarColors,
  sidebarPresetPatch,
  themePresetPatch,
  type EditorThemeId,
} from "../lib/editorAppearance";
import { useApp } from "../state/AppContext";
import { DEFAULT_PRICES, loadPrices, savePrices, type PriceRow } from "../lib/costEstimate";
import { DEFAULT_HOTKEYS, HOTKEY_LABELS, eventToHotkey, type HotkeyAction } from "../lib/hotkeys";
import { checkLicense, DEMO_LICENSE_KEY, isDemoLicenseAllowed } from "../lib/license";
import { kbEmbeddingApiReady } from "../lib/kb";

const QUICK_IDS = ["ModelScope", "DashScope", "Zhipu"];

type SectionId =
  | "engine"
  | "pipeline"
  | "habits"
  | "appearance"
  | "hotkeys"
  | "license"
  | "update";

type SettingsTab = "models" | "pipeline" | "appearance" | "backup" | "license";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "models", label: "模型与路由" },
  { id: "pipeline", label: "写作流水线" },
  { id: "appearance", label: "外观与热键" },
  { id: "backup", label: "备份与更新" },
  { id: "license", label: "授权中心" },
];

function parseSettingsTab(hash: string): SettingsTab {
  const raw = hash.replace(/^#/, "").trim().toLowerCase();
  if (raw === "models" || raw === "pipeline" || raw === "appearance" || raw === "backup" || raw === "license") {
    return raw;
  }
  return "models";
}

const HOTKEY_HINT =
  "Ctrl+S：Studio 各写作页手动保存；Ctrl+Enter：正文触发「写本章」，其它页触发对话生成；Ctrl+Shift+N：下一章；F11：专注。Studio 内 Ctrl+F 打开章内查找；Ctrl+Shift+F 书内搜索；Ctrl+Shift+P 上一章";

function SettingsSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  return (
    <div className="panel stack">
      <button
        type="button"
        className="btn btn-ghost"
        aria-expanded={open}
        onClick={() => onToggle(id)}
        style={{
          margin: 0,
          padding: "4px 0",
          width: "100%",
          justifyContent: "space-between",
          textAlign: "left",
        }}
      >
        <h3 style={{ margin: 0, fontFamily: "var(--font-brand)" }}>{title}</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}

export function SettingsPage() {
  const nav = useNavigate();
  const { settings, setSettings, providers, setProviders, llmReady } = useApp();
  const [form, setForm] = useState<AppSettings>(settings);
  const [list, setList] = useState<ProviderConfig[]>(providers);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [custom, setCustom] = useState({ name: "", baseUrl: "", apiKey: "", model: "" });
  const [prices, setPrices] = useState<PriceRow[]>(DEFAULT_PRICES);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    engine: true,
    pipeline: true,
    habits: true,
    appearance: true,
    hotkeys: true,
    license: true,
    update: true,
  });
  const [tab, setTab] = useState<SettingsTab>(() =>
    typeof window !== "undefined" ? parseSettingsTab(window.location.hash) : "models"
  );

  const [updateHint, setUpdateHint] = useState("");
  const [hasUpdate, setHasUpdate] = useState(false);
  const [dlLabel, setDlLabel] = useState("");
  const [dlState, setDlState] = useState("idle");
  const [dlPath, setDlPath] = useState("");
  const [dlPercent, setDlPercent] = useState(-1);
  const [dataNote, setDataNote] = useState("");
  const [versionLine, setVersionLine] = useState("");
  const [cardCode, setCardCode] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMsg, setLicenseMsg] = useState("");
  const [fpLine, setFpLine] = useState("");
  const [metaHint, setMetaHint] = useState("");

  function toggleSection(id: SectionId) {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function selectTab(next: SettingsTab) {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${next}`);
    }
  }

  useEffect(() => {
    function onHash() {
      setTab(parseSettingsTab(window.location.hash));
    }
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setForm({
      defaultModel: settings.defaultModel || "小说",
      stream: settings.stream !== false,
      routeOutline: settings.routeOutline || "复杂",
      routeChapter: settings.routeChapter || "小说",
      routeCheck: settings.routeCheck || "复杂",
      writePipelineEnabled: settings.writePipelineEnabled !== false,
      writePreset: settings.writePreset === "fast" ? "fast" : "quality",
      writePipelineSkipBeatsCheck: Boolean(settings.writePipelineSkipBeatsCheck),
      writePipelineSkipPolish: Boolean(settings.writePipelineSkipPolish),
      writePipelineWordGate: settings.writePipelineWordGate !== false,
      writePipelineBeatsCheck: settings.writePipelineBeatsCheck !== false,
      writePipelinePolish: settings.writePipelinePolish !== false,
      writePipelineMinRatio: settings.writePipelineMinRatio ?? 0.9,
      writePipelineMaxRatio: settings.writePipelineMaxRatio ?? 1.15,
      defaultChapterWords: settings.defaultChapterWords ?? 2500,
      updateApiBase: settings.updateApiBase || "",
      checkUpdateOnLaunch: settings.checkUpdateOnLaunch !== false,
      autoResume: settings.autoResume !== false,
      editorFontSize: settings.editorFontSize || 16,
      focusMode: Boolean(settings.focusMode),
      dailyWordGoal: settings.dailyWordGoal ?? 2000,
      autoBackupHours: settings.autoBackupHours ?? 0,
      lastAutoBackupAt: settings.lastAutoBackupAt ?? 0,
      firstLaunchAt: settings.firstLaunchAt,
      licenseKey: settings.licenseKey || "",
      licenseExpireAt: settings.licenseExpireAt,
      licenseTicketExpireAt: settings.licenseTicketExpireAt,
      licenseTimeUnlimited: settings.licenseTimeUnlimited,
      licenseActivatedOnline: settings.licenseActivatedOnline,
      licenseLastOnlineAt: settings.licenseLastOnlineAt,
      licenseGraceMs: settings.licenseGraceMs,
      licensePlanLabel: settings.licensePlanLabel || "",
      licenseDeviceCount: settings.licenseDeviceCount,
      licenseMaxDevices: settings.licenseMaxDevices,
      deviceFingerprint: settings.deviceFingerprint || "",
      updateChannel: settings.updateChannel === "beta" ? "beta" : "stable",
      shopUrl: settings.shopUrl || "",
      xianyuTip: settings.xianyuTip || "",
      editorTheme: settings.editorTheme || "ink",
      editorLineHeight: settings.editorLineHeight || 1.75,
      editorBgColor: settings.editorBgColor || "",
      editorFgColor: settings.editorFgColor || "",
      sidebarBgColor: settings.sidebarBgColor || "",
      sidebarFgColor: settings.sidebarFgColor || "",
      sidebarMutedColor: settings.sidebarMutedColor || "",
      sidebarFontSize: settings.sidebarFontSize || 13,
      hotkeys: {
        save: settings.hotkeys?.save || "Control+S",
        generate: settings.hotkeys?.generate || "Control+Enter",
        next: settings.hotkeys?.next || "Control+Shift+N",
        focus: settings.hotkeys?.focus || "F11",
        search: settings.hotkeys?.search || "Control+F",
      },
      editorEngine: settings.editorEngine === "textarea" ? "textarea" : "codemirror",
      kbAutoIndexChapters: settings.kbAutoIndexChapters !== false,
      kbEmbeddingEnabled: Boolean(settings.kbEmbeddingEnabled),
    });
  }, [settings]);
  useEffect(() => setList(providers), [providers]);
  useEffect(() => {
    void loadPrices(async (...p: string[]) => p.join("/")).then(setPrices);
  }, []);

  useEffect(() => {
    if (!window.moshu?.getDataPaths) return;
    void window.moshu.getDeviceFingerprint?.().then((f) => {
      if (f?.fingerprint) setFpLine(f.fingerprint.slice(0, 16) + "…");
    });
    void window.moshu.getCachedAppMeta?.().then((m) => {
      const n = (m?.announcements || []).length;
      setMetaHint(m?.status === 404 ? "公告接口未部署（已降级）" : `已缓存公告 ${n} 条`);
    });
    void window.moshu.getDataPaths().then((p) => {
      setVersionLine(`当前版本 ${p.versionName}（${p.versionCode}）`);
      setDataNote(p.note);
    });
    void window.moshu.getUpdateStatus?.().then((st: unknown) => {
      const s = st as {
        probe?: { hasUpdate?: boolean; hint?: string };
        download?: { state?: string; label?: string; filePath?: string; percent?: number };
      };
      if (s?.probe) {
        setHasUpdate(Boolean(s.probe.hasUpdate));
        setUpdateHint(s.probe.hint || "");
      }
      if (s?.download) {
        setDlState(s.download.state || "idle");
        setDlLabel(s.download.label || "");
        setDlPath(s.download.filePath || "");
        setDlPercent(s.download.percent ?? -1);
      }
    });
    const offProbe = window.moshu.onUpdateProbe?.((d) => {
      setHasUpdate(Boolean(d.hasUpdate));
      setUpdateHint(d.hint || "");
    });
    const offDl = window.moshu.onUpdateDownload?.((d) => {
      setDlState(d.state || "idle");
      setDlLabel(d.label || "");
      setDlPath(d.filePath || "");
      setDlPercent(d.percent ?? -1);
      if (d.error) setMsg(d.error);
    });
    return () => {
      offProbe?.();
      offDl?.();
    };
  }, []);

  async function persist(nextList: ProviderConfig[], nextForm?: AppSettings) {
    const f = nextForm || form;
    await setSettings(f);
    await setProviders(nextList);
    setList(nextList);
    setMsg("已保存");
  }

  async function openSignup(url?: string) {
    if (!url) return;
    if (window.moshu) await window.moshu.openExternal(url);
    else window.open(url, "_blank");
  }

  async function applyPaste() {
    const hit = detectPasteTarget(paste);
    if (!hit) {
      setMsg("未能识别，请手动填到下方渠道");
      return;
    }
    const next = list.map((p) =>
      p.id === hit.providerId ? { ...p, apiKey: hit.key, enabled: true } : p
    );
    setList(next);
    await persist(next);
    setMsg(`已写入 ${hit.providerId}`);
  }

  function updateProvider(id: string, patch: Partial<ProviderConfig>) {
    setList((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  const quick = list.filter((p) => QUICK_IDS.includes(p.id));
  const rest = list.filter((p) => !QUICK_IDS.includes(p.id));
  const routeOptions = ["小说", "长文", "复杂", "日常", "总结"];

  return (
    <div className="stack">
      <div>
        <h2 className="h2">设置</h2>
        <p className="muted">贴 Key 就能写。高级选项一般不用动。</p>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`settings-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "models" && (
      <SettingsSection
        id="engine"
        title="写作引擎"
        open={openSections.engine}
        onToggle={toggleSection}
      >
        <div className="row">
          <span className={`status-dot ${llmReady ? "ok" : "bad"}`} />
          <span>{llmReady ? "写作引擎就绪" : "还没配置可用 Key"}</span>
          <button className="btn btn-ghost" onClick={() => nav("/setup")}>
            打开简易向导
          </button>
        </div>

        <div className="field">
          <label>粘贴 Key（自动识别并保存）</label>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="ms-… / sk-… / nvapi-…"
            style={{ minHeight: 72 }}
          />
        </div>
        <button className="btn btn-primary" onClick={() => void applyPaste()}>
          识别并保存
        </button>
        {msg && <p className="ok-text">{msg}</p>}

        <div className="provider-grid">
          {quick.map((p) => (
            <div className="provider-card" key={p.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h4 style={{ margin: 0 }}>{p.name}</h4>
                <label className="muted" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })}
                  />{" "}
                  启用
                </label>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>{p.note}</p>
              <div className="field">
                <label>API Key</label>
                <input
                  type="password"
                  value={p.apiKey}
                  onChange={(e) =>
                    updateProvider(p.id, { apiKey: e.target.value, enabled: true })
                  }
                />
              </div>
              {p.signup && (
                <button className="btn" onClick={() => void openSignup(p.signup)}>
                  去申请
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => void persist(list)}>
          保存渠道
        </button>

        <div className="grid-2">
          <div className="field">
            <label>默认写作模式</label>
            <select
              value={form.defaultModel}
              onChange={(e) => {
                const next = { ...form, defaultModel: e.target.value };
                setForm(next);
                void persist(list, next);
              }}
            >
              {routeOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>大纲 / 设定路由</label>
            <select
              value={form.routeOutline || "复杂"}
              onChange={(e) => {
                const next = { ...form, routeOutline: e.target.value };
                setForm(next);
                void persist(list, next);
              }}
            >
              {routeOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>正文写本章路由</label>
            <select
              value={form.routeChapter || "小说"}
              onChange={(e) => {
                const next = { ...form, routeChapter: e.target.value };
                setForm(next);
                void persist(list, next);
              }}
            >
              {routeOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>校对 / 检查路由</label>
            <select
              value={form.routeCheck || "复杂"}
              onChange={(e) => {
                const next = { ...form, routeCheck: e.target.value };
                setForm(next);
                void persist(list, next);
              }}
            >
              {routeOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button className="btn btn-ghost" type="button" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "收起更多渠道与单价" : "更多渠道、自建与单价…"}
        </button>
        {advanced && (
          <>
            <div className="provider-grid">
              {rest.map((p) => (
                <div className="provider-card" key={p.id}>
                  <h4 style={{ margin: 0 }}>{p.name}</h4>
                  <label className="muted" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })}
                    />{" "}
                    启用
                  </label>
                  <div className="field">
                    <label>API Key</label>
                    <input
                      type="password"
                      value={p.apiKey}
                      onChange={(e) =>
                        updateProvider(p.id, { apiKey: e.target.value, enabled: true })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>接口地址</label>
                    <input
                      value={p.baseUrl}
                      onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })}
                    />
                  </div>
                  {p.signup && (
                    <button className="btn" onClick={() => void openSignup(p.signup)}>
                      去申请
                    </button>
                  )}
                </div>
              ))}
            </div>
            <h4>自建接口</h4>
            <div className="field">
              <label>名称</label>
              <input
                value={custom.name}
                onChange={(e) => setCustom({ ...custom, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>接口地址（…/v1）</label>
              <input
                value={custom.baseUrl}
                onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })}
              />
            </div>
            <div className="field">
              <label>API Key</label>
              <input
                value={custom.apiKey}
                onChange={(e) => setCustom({ ...custom, apiKey: e.target.value })}
              />
            </div>
            <div className="field">
              <label>模型名</label>
              <input
                value={custom.model}
                onChange={(e) => setCustom({ ...custom, model: e.target.value })}
              />
            </div>
            <button
              className="btn"
              onClick={() => {
                if (!custom.baseUrl || !custom.apiKey) {
                  setMsg("自建需要地址和 Key");
                  return;
                }
                const id = `custom_${Date.now()}`;
                const next: ProviderConfig[] = [
                  ...list,
                  {
                    id,
                    name: custom.name || "自建",
                    baseUrl: custom.baseUrl.replace(/\/$/, ""),
                    apiKey: custom.apiKey,
                    models: custom.model ? [custom.model] : [],
                    enabled: true,
                  },
                ];
                void persist(next, custom.model ? { ...form, defaultModel: custom.model } : form);
              }}
            >
              添加自建
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                const byId = new Map(list.map((p) => [p.id, p]));
                setList(
                  defaultProviders().map((p) => {
                    const old = byId.get(p.id);
                    return old ? { ...p, apiKey: old.apiKey, enabled: old.enabled } : p;
                  })
                );
              }}
            >
              同步预设列表
            </button>
            <button className="btn btn-primary" onClick={() => void persist(list, form)}>
              保存高级设置
            </button>

            <h4>费用粗估单价</h4>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              单位：元 / 千 tokens（粗算）。填 0 表示免费或不计。
            </p>
            {prices.map((row, i) => (
              <div className="row" key={row.providerId}>
                <span style={{ width: 100 }}>{row.label}</span>
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={row.cnyPer1k}
                  style={{ width: 120 }}
                  onChange={(e) => {
                    const next = [...prices];
                    next[i] = { ...row, cnyPer1k: Number(e.target.value) || 0 };
                    setPrices(next);
                  }}
                />
              </div>
            ))}
            <button
              className="btn"
              onClick={() => {
                savePrices(prices);
                setMsg("单价已保存");
              }}
            >
              保存单价
            </button>
          </>
        )}
      </SettingsSection>
      )}

      {tab === "pipeline" && (
      <>
      <SettingsSection
        id="pipeline"
        title="写作流水线"
        open={openSections.pipeline}
        onToggle={toggleSection}
      >
        <div className="field">
          <label>写作预设</label>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <label className="muted" style={{ fontSize: 13 }}>
              <input
                type="radio"
                name="writePreset"
                checked={(form.writePreset ?? "quality") === "quality"}
                onChange={() => {
                  const next = { ...form, writePreset: "quality" as const };
                  setForm(next);
                  void persist(list, next);
                }}
              />{" "}
              质量优先（多阶段流水线）
            </label>
            <label className="muted" style={{ fontSize: 13 }}>
              <input
                type="radio"
                name="writePreset"
                checked={form.writePreset === "fast"}
                onChange={() => {
                  const next = { ...form, writePreset: "fast" as const };
                  setForm(next);
                  void persist(list, next);
                }}
              />{" "}
              快速落稿（单次写章，跳过字数门禁/自检/润色）
            </label>
          </div>
        </div>
        <label className="muted" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.writePipelineEnabled !== false}
            onChange={(e) => {
              const next = { ...form, writePipelineEnabled: e.target.checked };
              setForm(next);
              void persist(list, next);
            }}
          />{" "}
          启用多阶段写作流水线
        </label>
        <div className="grid-2">
          {[
            ["writePipelineWordGate", "字数门禁"],
            ["writePipelineBeatsCheck", "细纲自检"],
            ["writePipelinePolish", "连贯与声口润色"],
          ].map(([key, label]) => (
            <label className="muted" style={{ fontSize: 13 }} key={key}>
              <input
                type="checkbox"
                checked={form[key as keyof AppSettings] !== false}
                disabled={form.writePipelineEnabled === false}
                onChange={(e) => {
                  const next = { ...form, [key]: e.target.checked };
                  setForm(next);
                  void persist(list, next);
                }}
              />{" "}
              {label}
            </label>
          ))}
        </div>
        <div className="grid-2">
          <label className="muted" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={Boolean(form.writePipelineSkipBeatsCheck)}
              disabled={form.writePipelineEnabled === false}
              onChange={(e) => {
                const next = { ...form, writePipelineSkipBeatsCheck: e.target.checked };
                setForm(next);
                void persist(list, next);
              }}
            />{" "}
            默认跳过细纲自检
          </label>
          <label className="muted" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={Boolean(form.writePipelineSkipPolish)}
              disabled={form.writePipelineEnabled === false}
              onChange={(e) => {
                const next = { ...form, writePipelineSkipPolish: e.target.checked };
                setForm(next);
                void persist(list, next);
              }}
            />{" "}
            默认跳过润色
          </label>
        </div>
        <div className="field">
          <label>默认单章目标字数</label>
          <input
            type="number"
            min={800}
            max={8000}
            step={100}
            value={form.defaultChapterWords ?? 2500}
            onChange={(e) =>
              setForm({
                ...form,
                defaultChapterWords: Math.max(800, Number(e.target.value) || 2500),
              })
            }
            onBlur={() => void persist(list, form)}
          />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          字数门禁默认以目标字数的{" "}
          {Math.round((form.writePipelineMinRatio ?? 0.9) * 100)}%～{" "}
          {Math.round((form.writePipelineMaxRatio ?? 1.15) * 100)}% 为达标范围；不足会补写，
          超出会轻度压缩。快速预设会忽略上方流水线开关，直接单次落稿。
        </p>
      </SettingsSection>

      <SettingsSection
        id="habits"
        title="写作习惯"
        open={openSections.habits}
        onToggle={toggleSection}
      >
        <div className="field">
          <label>每日字数目标</label>
          <input
            type="number"
            min={0}
            step={100}
            value={form.dailyWordGoal ?? 2000}
            onChange={(e) =>
              setForm({ ...form, dailyWordGoal: Math.max(0, Number(e.target.value) || 0) })
            }
            onBlur={() => void persist(list, form)}
          />
        </div>
        <label className="muted" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.autoResume !== false}
            onChange={(e) => {
              const next = { ...form, autoResume: e.target.checked };
              setForm(next);
              void persist(list, next);
            }}
          />{" "}
          启动时自动回到上次书稿
        </label>
        <div className="field">
          <label>自动备份间隔（小时，0 = 关闭）</label>
          <input
            type="number"
            min={0}
            max={168}
            value={form.autoBackupHours ?? 0}
            onChange={(e) =>
              setForm({
                ...form,
                autoBackupHours: Math.max(0, Math.min(168, Number(e.target.value) || 0)),
              })
            }
            onBlur={() => void persist(list, form)}
          />
        </div>
        <div className="field">
          <label>边写边出字</label>
          <select
            value={form.stream ? "1" : "0"}
            onChange={(e) => {
              const next = { ...form, stream: e.target.value === "1" };
              setForm(next);
              void persist(list, next);
            }}
          >
            <option value="1">开</option>
            <option value="0">关</option>
          </select>
        </div>
        <label className="muted" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.kbAutoIndexChapters !== false}
            onChange={(e) => {
              const next = { ...form, kbAutoIndexChapters: e.target.checked };
              setForm(next);
              void persist(list, next);
            }}
          />{" "}
          保存正文时自动写入知识库切片
        </label>
        <label className="muted" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={Boolean(form.kbEmbeddingEnabled)}
            onChange={(e) => {
              const next = { ...form, kbEmbeddingEnabled: e.target.checked };
              setForm(next);
              void persist(list, next);
            }}
          />{" "}
          启用 Embedding 向量检索（实验）
        </label>
        {form.kbEmbeddingEnabled ? (
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
            {kbEmbeddingApiReady(list)
              ? "将调用当前启用渠道的 OpenAI 兼容 /embeddings；失败自动回退 MiniSearch。"
              : "当前无可用渠道 Key，检索仍回退 MiniSearch，不影响写作。"}
          </p>
        ) : null}
      </SettingsSection>
      </>
      )}

      {tab === "appearance" && (
      <>
      <SettingsSection
        id="appearance"
        title="外观"
        open={openSections.appearance}
        onToggle={toggleSection}
      >
        <div className="field">
          <label>Studio 编辑器引擎</label>
          <select
            value={form.editorEngine === "textarea" ? "textarea" : "codemirror"}
            onChange={(e) => {
              const next = {
                ...form,
                editorEngine: e.target.value === "textarea" ? "textarea" as const : "codemirror" as const,
              };
              setForm(next);
              void persist(list, next);
            }}
          >
            <option value="codemirror">CodeMirror（默认）</option>
            <option value="textarea">纯文本框（兼容回退）</option>
          </select>
        </div>
        <div className="field">
          <label>正文编辑器字号（{form.editorFontSize || 16}px）</label>
          <input
            type="range"
            min={12}
            max={36}
            value={form.editorFontSize || 16}
            onChange={(e) => {
              const next = { ...form, editorFontSize: Number(e.target.value) };
              setForm(next);
              void persist(list, next);
            }}
          />
        </div>
        <div className="field">
          <label>行距（{form.editorLineHeight || 1.75}）</label>
          <input
            type="range"
            min={14}
            max={24}
            value={Math.round((form.editorLineHeight || 1.75) * 10)}
            onChange={(e) => {
              const next = { ...form, editorLineHeight: Number(e.target.value) / 10 };
              setForm(next);
              void persist(list, next);
            }}
          />
        </div>
        <div className="field">
          <label>编辑器配色主题（成套：底色+字色一起变）</label>
          <select
            value={form.editorTheme || "ink"}
            onChange={(e) => {
              const patch = themePresetPatch(e.target.value as EditorThemeId);
              const next = { ...form, ...patch };
              setForm(next);
              void persist(list, next);
            }}
          >
            {EDITOR_THEME_IDS.map((id) => (
              <option key={id} value={id}>
                {EDITOR_THEME_PRESETS[id].label}
                {EDITOR_THEME_PRESETS[id].tone === "dark" ? "（深色）" : "（浅色）"}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <div className="field" style={{ minWidth: 140 }}>
            <label>自定义背景色</label>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={resolveEditorColors(form).bg}
                onChange={(e) => {
                  const next = { ...form, editorBgColor: e.target.value };
                  setForm(next);
                  void persist(list, next);
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => {
                  const p = themePresetPatch((form.editorTheme as EditorThemeId) || "ink");
                  const next = { ...form, ...p };
                  setForm(next);
                  void persist(list, next);
                }}
              >
                恢复成套
              </button>
            </div>
          </div>
          <div className="field" style={{ minWidth: 140 }}>
            <label>自定义文字色</label>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={resolveEditorColors(form).fg}
                onChange={(e) => {
                  const next = { ...form, editorFgColor: e.target.value };
                  setForm(next);
                  void persist(list, next);
                }}
              />
            </div>
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          换主题会同时改编辑区与侧栏底色/字色；写作页顶栏与侧栏底部也可调。
        </p>
        <div className="field">
          <label>侧栏字号（{form.sidebarFontSize || 13}px）</label>
          <input
            type="range"
            min={11}
            max={18}
            value={form.sidebarFontSize || 13}
            onChange={(e) => {
              const next = { ...form, sidebarFontSize: Number(e.target.value) };
              setForm(next);
              void persist(list, next);
            }}
          />
        </div>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <div className="field" style={{ minWidth: 120 }}>
            <label>侧栏背景</label>
            <input
              type="color"
              value={resolveSidebarColors(form).bg}
              onChange={(e) => {
                const next = { ...form, sidebarBgColor: e.target.value };
                setForm(next);
                void persist(list, next);
              }}
            />
          </div>
          <div className="field" style={{ minWidth: 120 }}>
            <label>侧栏主文字</label>
            <input
              type="color"
              value={resolveSidebarColors(form).fg}
              onChange={(e) => {
                const next = { ...form, sidebarFgColor: e.target.value };
                setForm(next);
                void persist(list, next);
              }}
            />
          </div>
          <div className="field" style={{ minWidth: 120 }}>
            <label>侧栏次要字</label>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={resolveSidebarColors(form).muted}
                onChange={(e) => {
                  const next = { ...form, sidebarMutedColor: e.target.value };
                  setForm(next);
                  void persist(list, next);
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => {
                  const p = sidebarPresetPatch((form.editorTheme as EditorThemeId) || "ink");
                  const next = { ...form, ...p };
                  setForm(next);
                  void persist(list, next);
                }}
              >
                侧栏跟主题
              </button>
            </div>
          </div>
        </div>
        <label className="muted" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={Boolean(form.focusMode)}
            onChange={(e) => {
              const next = { ...form, focusMode: e.target.checked };
              setForm(next);
              void persist(list, next);
            }}
          />{" "}
          专注模式（隐藏侧栏）
        </label>
      </SettingsSection>

      <SettingsSection
        id="hotkeys"
        title="快捷键"
        open={openSections.hotkeys}
        onToggle={toggleSection}
      >
        <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.55 }}>
          {HOTKEY_HINT}
        </p>
        <div className="stack" style={{ gap: 8 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            自定义快捷键（点输入框后按下组合键）
          </div>
          {(Object.keys(HOTKEY_LABELS) as HotkeyAction[]).map((action) => (
            <div className="field" key={action}>
              <label>{HOTKEY_LABELS[action]}</label>
              <input
                value={form.hotkeys?.[action] || DEFAULT_HOTKEYS[action]}
                readOnly
                onKeyDown={(e) => {
                  e.preventDefault();
                  const combo = eventToHotkey(e);
                  if (!combo || combo === "Control" || combo === "Alt" || combo === "Shift") return;
                  const next = {
                    ...form,
                    hotkeys: { ...DEFAULT_HOTKEYS, ...form.hotkeys, [action]: combo },
                  };
                  setForm(next);
                  void persist(list, next);
                }}
              />
            </div>
          ))}
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              const next = { ...form, hotkeys: { ...DEFAULT_HOTKEYS } };
              setForm(next);
              void persist(list, next);
            }}
          >
            恢复默认快捷键
          </button>
        </div>
      </SettingsSection>
      </>
      )}

      {tab === "license" && (
      <SettingsSection
        id="license"
        title="授权中心"
        open={openSections.license}
        onToggle={toggleSection}
      >
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          首次启动起试用 14 天。正式授权请兑换卡密（联网激活，设备绑定）。试用到期且无有效授权时仅软禁用生成，不阻拦打开书稿。
          {isDemoLicenseAllowed() ? (
            <>
              {" "}
              开发模式可用演示码 <code>{DEMO_LICENSE_KEY}</code>。
            </>
          ) : null}
        </p>
        <p style={{ margin: 0, fontSize: 13 }}>
          状态：{checkLicense(form).reason}
          {form.licensePlanLabel ? ` · ${form.licensePlanLabel}` : ""}
        </p>
        {(form.licenseDeviceCount != null || form.licenseMaxDevices != null) && (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            设备席位：{form.licenseDeviceCount ?? "-"} / {form.licenseMaxDevices ?? "-"}
            {fpLine ? ` · 指纹 ${fpLine}` : ""}
          </p>
        )}
        <div className="field">
          <label>卡密</label>
          <input
            type="text"
            placeholder="粘贴购买获得的卡密"
            value={cardCode}
            onChange={(e) => setCardCode(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={licenseBusy || !cardCode.trim()}
            onClick={() => {
              void (async () => {
                if (!window.moshu?.licenseRedeem) {
                  setLicenseMsg("当前环境不支持联网激活（需桌面客户端）");
                  return;
                }
                setLicenseBusy(true);
                setLicenseMsg("");
                try {
                  const st = await window.moshu.licenseRedeem(cardCode.trim());
                  setLicenseMsg(st.message || (st.valid ? "激活成功" : "激活失败"));
                  if (st.settingsPatch) {
                    const next = { ...form, ...st.settingsPatch, licenseKey: cardCode.trim() };
                    setForm(next);
                    await persist(list, next);
                  }
                  setCardCode("");
                } catch (e) {
                  setLicenseMsg(e instanceof Error ? e.message : String(e));
                } finally {
                  setLicenseBusy(false);
                }
              })();
            }}
          >
            {licenseBusy ? "处理中…" : "兑换 / 激活"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={licenseBusy}
            onClick={() => {
              void (async () => {
                if (!window.moshu?.licenseStatus) return;
                setLicenseBusy(true);
                try {
                  const st = await window.moshu.licenseStatus();
                  setLicenseMsg(st.message || (st.valid ? "授权有效" : "未激活"));
                  if (st.settingsPatch) {
                    const next = { ...form, ...st.settingsPatch };
                    setForm(next);
                    await persist(list, next);
                  }
                } catch (e) {
                  setLicenseMsg(e instanceof Error ? e.message : String(e));
                } finally {
                  setLicenseBusy(false);
                }
              })();
            }}
          >
            刷新状态
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={licenseBusy}
            onClick={() => {
              void (async () => {
                if (!window.moshu?.licenseUnbind) return;
                if (!confirm("确认解绑本机席位？解绑后需重新兑换或在其他设备腾出席位。")) return;
                setLicenseBusy(true);
                try {
                  const st = await window.moshu.licenseUnbind();
                  setLicenseMsg(st.message || "已解绑");
                  if (st.settingsPatch) {
                    const next = { ...form, ...st.settingsPatch };
                    setForm(next);
                    await persist(list, next);
                  }
                } catch (e) {
                  setLicenseMsg(e instanceof Error ? e.message : String(e));
                } finally {
                  setLicenseBusy(false);
                }
              })();
            }}
          >
            解绑本机
          </button>
        </div>
        {licenseMsg && (
          <p style={{ margin: 0, fontSize: 13 }}>{licenseMsg}</p>
        )}
        <div className="field">
          <label>购买链接（商城）</label>
          <input
            value={form.shopUrl || ""}
            placeholder="https://…"
            onChange={(e) => setForm({ ...form, shopUrl: e.target.value })}
            onBlur={() => void persist(list, form)}
          />
        </div>
        <div className="field">
          <label>闲鱼提示文案</label>
          <input
            value={form.xianyuTip || ""}
            placeholder="例如：闲鱼搜「大帅墨枢」自动发货"
            onChange={(e) => setForm({ ...form, xianyuTip: e.target.value })}
            onBlur={() => void persist(list, form)}
          />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {form.shopUrl ? (
            <button
              type="button"
              className="btn"
              onClick={() => void window.moshu?.openExternal(form.shopUrl || "")}
            >
              打开商城购买
            </button>
          ) : null}
        </div>
        {form.xianyuTip ? (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            {form.xianyuTip}
          </p>
        ) : null}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              void (async () => {
                const m = await window.moshu?.fetchAppMeta?.();
                if (!m) {
                  setMetaHint("无法拉取公告");
                  return;
                }
                const n = (m.announcements || []).length;
                setMetaHint(
                  m.status === 404
                    ? "公告接口 404，已降级为空"
                    : `已刷新公告 ${n} 条${m.maintenance?.enabled ? " · 维护中" : ""}`
                );
                if (m.shopUrl && !form.shopUrl) {
                  const next = { ...form, shopUrl: m.shopUrl, xianyuTip: m.xianyuTip || form.xianyuTip };
                  setForm(next);
                  await persist(list, next);
                }
              })();
            }}
          >
            刷新公告
          </button>
          <span className="muted" style={{ fontSize: 12 }}>{metaHint}</span>
        </div>
      </SettingsSection>
      )}

      {tab === "backup" && (
      <SettingsSection
        id="update"
        title="备份与更新"
        open={openSections.update}
        onToggle={toggleSection}
      >
        {versionLine && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{versionLine}</p>}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {dataNote ||
            "覆盖安装不会删除 API Key、设置与「文档/大帅墨枢」下的书稿（与程序安装目录分开存放）。"}
        </p>
        {updateHint && (
          <p style={{ margin: 0, fontSize: 13, color: hasUpdate ? "var(--ok, #2a7)" : undefined }}>
            {updateHint}
          </p>
        )}
        {dlLabel && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {dlLabel}
            {dlPercent >= 0 ? ` · ${dlPercent}%` : ""}
          </p>
        )}
        <div className="field">
          <label>更新渠道</label>
          <select
            value={form.updateChannel === "beta" ? "beta" : "stable"}
            onChange={(e) => {
              const next = {
                ...form,
                updateChannel: e.target.value === "beta" ? ("beta" as const) : ("stable" as const),
              };
              setForm(next);
              void persist(list, next);
            }}
          >
            <option value="stable">正式版（stable）</option>
            <option value="beta">测试版（beta）</option>
          </select>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (!window.moshu?.checkForUpdates) {
                setMsg("浏览器预览不支持；请用桌面端");
                return;
              }
              setMsg("正在检查…");
              const r = await window.moshu.checkForUpdates();
              setHasUpdate(Boolean(r.hasUpdate));
              setUpdateHint(r.message);
              setMsg(r.message);
            }}
          >
            检查更新
          </button>
          {hasUpdate && (
            <button
              className="btn"
              disabled={dlState === "downloading"}
              onClick={async () => {
                if (!window.moshu?.downloadUpdate) return;
                setMsg("开始下载…");
                const d = await window.moshu.downloadUpdate();
                setDlState(d.state);
                setDlLabel(d.label);
                setDlPath(d.filePath);
                setDlPercent(d.percent);
                if (d.error) setMsg(d.error);
                else if (d.state === "done") setMsg("下载完成，可运行安装包");
              }}
            >
              {dlState === "downloading" ? "下载中…" : "下载安装包"}
            </button>
          )}
          {dlState === "downloading" && (
            <button
              className="btn btn-ghost"
              onClick={() => void window.moshu?.cancelUpdateDownload?.()}
            >
              取消下载
            </button>
          )}
          {dlState === "done" && dlPath && (
            <button
              className="btn"
              onClick={async () => {
                const r = await window.moshu?.openInstaller?.(dlPath);
                if (r) setMsg(r.message);
              }}
            >
              运行安装包
            </button>
          )}
        </div>
        <label className="muted" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.checkUpdateOnLaunch !== false}
            onChange={(e) => {
              const next = { ...form, checkUpdateOnLaunch: e.target.checked };
              setForm(next);
              void persist(list, next);
            }}
          />{" "}
          启动时静默检查更新
        </label>
        <div className="field">
          <label>更新源地址（高级，一般留空）</label>
          <input
            value={form.updateApiBase || ""}
            placeholder="留空 = 官方默认"
            onChange={(e) => setForm({ ...form, updateApiBase: e.target.value })}
            onBlur={() => void persist(list, form)}
          />
        </div>
      </SettingsSection>
      )}
    </div>
  );
}
