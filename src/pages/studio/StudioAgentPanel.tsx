import type { ReactNode, RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentMsg, StudioMode } from "../../lib/agentChatStore";
import {
  modeAgentHint,
  modeGenerateButtonLabel,
  modeGenerateListButtonLabel,
} from "../../lib/prompts";
import type { VolumeEntry } from "../../lib/volumes";
import { WorkbenchComposer } from "../../components/workbench/WorkbenchComposer";
import { PreflightButton } from "../../components/workbench/PreflightButton";
import { formatQuotaTip } from "../../components/workbench/preflight";
import type { PreflightResult } from "../../components/workbench/types";
import { modeLabel, type EditScope } from "./studioShared";

export type StudioAgentPanelProps = {
  mode: StudioMode;
  /** 工作台节点（物料灯条 / 补料卡 / 队列面板），插在 Agent 栏头部下方 */
  workbench?: ReactNode;
  editScope: EditScope | null;
  messages: AgentMsg[];
  input: string;
  setInput: (v: string) => void;
  agentBusy: boolean;
  busy: boolean;
  cancel: () => void;
  generateDisabled: boolean;
  licenseOk: boolean;
  licenseReason?: string;
  /** Flow D：主生成按钮的内联预检（缺省则退回普通按钮） */
  preflight?: PreflightResult;
  estimatedCostCny?: number;
  remainingQuotaCny?: number;
  chaptersPerVolume: number;
  volumeId: string;
  chapterId: string;
  chapterTitle: string;
  chapterBeats: string;
  currentVolume: VolumeEntry | null;
  doc: string;
  chatEndRef: RefObject<HTMLDivElement | null>;
  clearChat: () => void;
  sendChat: (text?: string) => void;
  generateFromChat: (replace?: boolean, beatsPhase?: "list" | "full") => void;
  applyToEditor: (text: string, replace: boolean) => void | Promise<void>;
};

export function StudioAgentPanel(p: StudioAgentPanelProps) {
  const nav = useNavigate();
  const {
    mode,
    workbench,
    editScope,
    messages,
    input,
    setInput,
    agentBusy,
    busy,
    cancel,
    licenseOk,
    licenseReason,
    preflight,
    estimatedCostCny,
    remainingQuotaCny,
    chaptersPerVolume,
    volumeId,
    chapterId,
    chapterTitle,
    chapterBeats,
    doc,
    chatEndRef,
    clearChat,
    sendChat,
    generateFromChat,
    applyToEditor,
  } = p;

  const quotaTip = preflight ? formatQuotaTip(preflight) : "";
  const generateSlot = (
    <>
      {mode === "beats" && (
        <PreflightButton
          label={busy ? "生成中…" : modeGenerateListButtonLabel()}
          preflight={preflight ?? { ok: licenseOk }}
          licenseInvalid={!licenseOk}
          loading={busy}
          disabled={busy || agentBusy || !messages.length}
          onProceed={() => void generateFromChat(true, "list")}
          onUpgrade={() => nav("/app/settings")}
          onSwitchChannel={() => nav("/setup")}
          estimatedCostCny={estimatedCostCny}
          remainingQuotaCny={remainingQuotaCny}
          buttonProps={{
            type: "default",
            title: !licenseOk ? licenseReason : `先落约 ${chaptersPerVolume} 章的目录，再补场次更稳`,
          }}
        />
      )}
      <PreflightButton
        label={busy ? "生成中…" : modeGenerateButtonLabel(mode)}
        preflight={preflight ?? { ok: licenseOk }}
        licenseInvalid={!licenseOk}
        loading={busy}
        disabled={busy || agentBusy || !messages.length}
        onProceed={() => void generateFromChat(true, "full")}
        onUpgrade={() => nav("/app/settings")}
        onSwitchChannel={() => nav("/setup")}
        estimatedCostCny={estimatedCostCny}
        remainingQuotaCny={remainingQuotaCny}
        buttonProps={{
          title: quotaTip || (!licenseOk ? licenseReason : undefined),
        }}
      />
    </>
  );

  return (
      <aside className="studio-agent">
        <div className="studio-agent-head">
          <div>
            <strong>Agent</strong>
            <span className="muted"> {modeAgentHint(mode)}</span>
            {editScope && (
              <span className="studio-agent-scope"> · 改「{editScope.label}」</span>
            )}
          </div>
          <button type="button" className="btn btn-ghost btn-compact" onClick={() => void clearChat()}>
            清空对话
          </button>
        </div>

        {workbench && <div className="studio-agent-workbench">{workbench}</div>}

        <div className="studio-agent-msgs">
          {messages.length === 0 && (
            <div className="studio-agent-empty">
              <p>
                当前在「{modeLabel(mode)}」页：右侧对话、中间只落{modeLabel(mode)}稿。
              </p>
              <ul>
                {mode === "idea" && (
                  <>
                    <li>本页产出：设定草稿（卖点/世界观/人物/禁忌）</li>
                    <li>全书总述去「总纲」；章目录与卷简介去「细纲」</li>
                  </>
                )}
                {mode === "outline" && (
                  <>
                    <li>本页产出：总纲（梗概 / 世界观 / 人物 / 分卷主题）</li>
                    <li>不要写第N章列表；分章去「细纲」，正文去「正文」</li>
                  </>
                )}
                {mode === "beats" && (
                  <>
                    <li>细纲按卷：每一卷一份（本卷简介 + 章节 + 场次）</li>
                    <li>
                      左侧「卷目录」或顶栏切换卷；点「+新建卷」开第 N 卷
                    </li>
                    <li>一卷默认约 {chaptersPerVolume} 章；可先「章节目录」再补场次</li>
                  </>
                )}
                {mode === "chapter" && (
                  <>
                    <li>本页产出：本章正文（章目录以细纲为准）</li>
                    <li>
                      {chapterBeats.trim()
                        ? "已载入本章细纲；优先用中间栏「写本章」（全链路：钩子/上章/KB）"
                        : "⚠ 细纲里还没有本章，请先去「细纲」补章"}
                    </li>
                    <li>
                      像 Cursor 一样：中间划选一段 →「锁定给 Agent 改」→ 右侧描述如何改 →「替换锁定范围」
                    </li>
                    <li>也可点「整篇交给 Agent」对整章描述调整</li>
                  </>
                )}
                <li>
                  {mode === "chapter"
                    ? "写章请用中间栏「写本章」；局部改稿用选区锁定"
                    : `聊清楚后点下方「${modeGenerateButtonLabel(mode)}」；也可划选局部让 Agent 改`}
                </li>
              </ul>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`studio-msg ${m.role}`}>
              <div className="studio-msg-role">{m.role === "user" ? "你" : "Agent"}</div>
              <div className="studio-msg-body">
                {m.content || (agentBusy && i === messages.length - 1 ? "…" : "")}
              </div>
              {m.role === "assistant" && m.content.trim() && (
                <div className="studio-msg-actions">
                  {editScope ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      onClick={() => void applyToEditor(m.content, true)}
                    >
                      替换锁定范围
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="linkish studio-msg-apply"
                    onClick={() => void applyToEditor(m.content, !doc.trim())}
                  >
                    写入编辑器
                  </button>
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="studio-agent-foot">
          <WorkbenchComposer
            input={input}
            setInput={setInput}
            agentBusy={agentBusy}
            busy={busy}
            generateLabel={modeGenerateButtonLabel(mode)}
            messagesEmpty={messages.length === 0}
            suggestions={
              mode === "chapter"
                ? [
                    `先聊「${chapterId} ${chapterTitle}」这一章要达成什么情绪与冲突，不要直接写正文`,
                    "请对照本章细纲做连贯检查：场次是否落全、情绪弧是否断裂、有无跑偏细纲；列出问题并给改写建议（先别整章重写）。",
                  ]
                : mode === "beats"
                  ? [
                      `「${volumeId}」按网文一卷来排，目标约 ${chaptersPerVolume} 章：先聊本卷简介、开卷钩子、中段升级、卷末高潮（先别写正文）`,
                    ]
                  : mode === "outline"
                    ? ["帮我写全书总纲：卖点、梗概、世界观、主要人物、主线冲突、分卷主题（禁止输出第N章列表）"]
                    : ["帮我梳理卖点、世界观规则、主角与核心冲突（不要写章节正文）"]
            }
            placeholder={
              editScope
                ? `描述如何改「${editScope.label}」… Enter 发送`
                : mode === "idea"
                  ? "聊设定草稿…（全书总述→总纲；章目录→细纲）Enter 发送"
                  : mode === "outline"
                    ? "聊总纲：梗概/世界观/人物/分卷主题… Enter 发送"
                    : mode === "beats"
                      ? "聊本卷简介与章节细纲… Enter 发送"
                      : "聊本章正文，或先划选一段再描述怎么改… Enter 发送"
            }
            onSend={(t) => void sendChat(t)}
            onCancel={cancel}
            onGenerate={() => void generateFromChat(true, "full")}
            canGenerate={licenseOk && !busy && !agentBusy && messages.length > 0}
            generateBlockReason={
              !licenseOk ? licenseReason : messages.length === 0 ? "先和 Agent 聊几句再生成" : null
            }
            generateSlot={generateSlot}
          />
        </div>
      </aside>
  );
}
