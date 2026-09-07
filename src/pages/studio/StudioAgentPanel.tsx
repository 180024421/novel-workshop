import type { RefObject } from "react";
import type { AgentMsg, StudioMode } from "../../lib/agentChatStore";
import {
  modeAgentHint,
  modeGenerateButtonLabel,
  modeGenerateListButtonLabel,
} from "../../lib/prompts";
import type { VolumeEntry } from "../../lib/volumes";
import { modeLabel, type EditScope } from "./studioShared";

export type StudioAgentPanelProps = {
  mode: StudioMode;
  editScope: EditScope | null;
  messages: AgentMsg[];
  input: string;
  setInput: (v: string) => void;
  agentBusy: boolean;
  busy: boolean;
  generateDisabled: boolean;
  licenseOk: boolean;
  licenseReason?: string;
  chaptersPerVolume: number;
  volumeId: string;
  chapterId: string;
  chapterTitle: string;
  chapterBeats: string;
  currentVolume: VolumeEntry | null;
  doc: string;
  lastAssistant: AgentMsg | undefined;
  chatEndRef: RefObject<HTMLDivElement | null>;
  clearChat: () => void;
  sendChat: (text?: string) => void;
  generateFromChat: (replace?: boolean, beatsPhase?: "list" | "full") => void;
  applyToEditor: (text: string, replace: boolean) => void | Promise<void>;
};

export function StudioAgentPanel(p: StudioAgentPanelProps) {
  const {
    mode,
    editScope,
    messages,
    input,
    setInput,
    agentBusy,
    busy,
    generateDisabled,
    licenseOk,
    licenseReason,
    chaptersPerVolume,
    volumeId,
    chapterId,
    chapterTitle,
    chapterBeats,
    currentVolume,
    doc,
    lastAssistant,
    chatEndRef,
    clearChat,
    sendChat,
    generateFromChat,
    applyToEditor,
  } = p;

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
              <div className="studio-quick">
                {mode === "idea" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void sendChat("帮我梳理卖点、世界观规则、主角与核心冲突（不要写章节正文）")}
                    >
                      梳理卖点与冲突
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendChat("主要人物各是什么身份与声口？人物之间有哪些张力？（仍停留在设定层）")}
                    >
                      聊人物张力
                    </button>
                  </>
                )}
                {mode === "outline" && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          "帮我写全书总纲：卖点、梗概、世界观、主要人物、主线冲突、分卷主题（禁止输出第N章列表）"
                        )
                      }
                    >
                      梳理全书总纲
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendChat("各卷主题弧线怎么排？每卷一句话即可，不要拆章。")}
                    >
                      聊分卷主题
                    </button>
                  </>
                )}
                {mode === "beats" && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          `「${volumeId}」按网文一卷来排，目标约 ${chaptersPerVolume} 章：先聊本卷简介、开卷钩子、中段升级、卷末高潮（先别写正文）`
                        )
                      }
                    >
                      聊本卷骨架
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          `请按约 ${chaptersPerVolume} 章规划本卷目录（要很多章，不要只给几章）。已有：${
                            (currentVolume?.chapters || []).map((c) => c.id).join("、") || "（尚无）"
                          }`
                        )
                      }
                    >
                      聊章目录（多章）
                    </button>
                  </>
                )}
                {mode === "chapter" && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          `先聊「${chapterId} ${chapterTitle}」这一章要达成什么情绪与冲突，不要直接写正文`
                        )
                      }
                    >
                      聊本章目标
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendChat("这一章对白想偏什么样的声口？")}
                    >
                      聊声口
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          "请对照本章细纲做连贯检查：场次是否落全、情绪弧是否断裂、有无跑偏细纲；列出问题并给改写建议（先别整章重写）。"
                        )
                      }
                    >
                      对照细纲检查
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void sendChat(
                          "请按人物声口卡，挑一处对白改得更贴身份与性格；说明改了谁、为何更贴，并给出改写后的一小段。"
                        )
                      }
                    >
                      按人物声口改一处
                    </button>
                  </>
                )}
              </div>
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
                    {doc.trim() ? "写入编辑器" : "写入编辑器"}
                  </button>
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="studio-agent-foot">
          <div className="studio-agent-tools">
            {mode === "beats" && (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                disabled={generateDisabled}
                onClick={() => void generateFromChat(true, "list")}
                title={
                  !licenseOk
                    ? licenseReason
                    : `先落约 ${chaptersPerVolume} 章的目录，再补场次更稳`
                }
              >
                {busy ? "生成中…" : modeGenerateListButtonLabel()}
              </button>
            )}
            <button
              type="button"
              className={`btn btn-compact ${
                mode === "chapter" ? "btn-ghost" : "btn-primary"
              }`}
              disabled={generateDisabled}
              title={
                !licenseOk
                  ? licenseReason
                  : mode === "chapter"
                    ? "对话改稿后再生成；写新章请优先用中间栏「写本章」"
                    : undefined
              }
              onClick={() => void generateFromChat(true, "full")}
            >
              {busy ? "生成中…" : modeGenerateButtonLabel(mode)}
            </button>
            {lastAssistant?.content.trim() && (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                disabled={busy || agentBusy}
                onClick={() => void applyToEditor(lastAssistant.content, true)}
              >
                用最近回复覆盖
              </button>
            )}
          </div>
          <textarea
            className="studio-agent-input"
            rows={3}
            value={input}
            disabled={agentBusy}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendChat();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={agentBusy || !input.trim()}
            onClick={() => void sendChat()}
          >
            {agentBusy ? "思考中…" : "发送"}
          </button>
        </div>
      </aside>
  );
}
