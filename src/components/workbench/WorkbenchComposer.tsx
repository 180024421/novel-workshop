/* ================================================
   FLOW: 写作主循环工作台 (Writing Workbench)
   SCREEN 3 of 4: 生成中态（Composer → Stop）
   SCREEN 4 of 4: 完成态（Composer 复位「下一步指令…」）
   ------------------------------------------------
   ENTRY:  Screen 1/2 主生成或聊天发送
   EXIT:   流式结束 → Screen 4；正文实时落中间编辑器（非气泡）
   BRANCH: Stop → 截断保留 + 可继续；失败 → 错误由右栏消息流内联展示
   ================================================ */
import { Button, Flex, Input, Tooltip } from "antd";
import { SendOutlined, StopOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { KeyboardEvent, ReactNode } from "react";

export type WorkbenchComposerProps = {
  input: string;
  setInput: (v: string) => void;
  /** 聊天流式回复中 */
  agentBusy: boolean;
  /** 生稿（流水线）进行中 */
  busy: boolean;
  /** 生成主按钮文案（来自 modeGenerateButtonLabel(mode)） */
  generateLabel: string;
  /** 空对话时的任务建议 chips（点击=填充并发送） */
  suggestions?: string[];
  /** 当前无任何对话消息 → 显示 suggestions */
  messagesEmpty?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onCancel: () => void;
  onGenerate: () => void;
  /** 主生成按钮是否可用（含 license / 额度 / 物料预检，由父级计算） */
  canGenerate: boolean;
  /** generate 禁用时给原因（Tooltip） */
  generateBlockReason?: string | null;
  /** 父级自带生成按钮（如 PreflightButton 组合）时覆盖默认生成按钮行 */
  generateSlot?: ReactNode;
};

/**
 * 一体化 Composer：对话输入 + 主生成 + 停止，三合一常驻右栏底部。
 * 约定：Enter 发送 / Shift+Enter 换行（IM 组合输入不触发）；
 * 异步中按钮用 loading / 切换为 Stop，不清空输入。
 */
export function WorkbenchComposer({
  input,
  setInput,
  agentBusy,
  busy,
  generateLabel,
  suggestions = [],
  messagesEmpty = false,
  placeholder = "和 Agent 说说什么…（Enter 发送，Shift+Enter 换行）",
  onSend,
  onCancel,
  onGenerate,
  canGenerate,
  generateBlockReason,
  generateSlot,
}: WorkbenchComposerProps) {
  const streaming = agentBusy || busy;

  const send = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    onSend(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // 中文 IME 组词期间的 Enter 是「上屏」，不能误发送
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      send();
    }
  };

  const generateBtn = (
    <Button
      type="primary"
      ghost={!canGenerate}
      icon={<ThunderboltOutlined />}
      loading={busy}
      disabled={!canGenerate && !busy}
      onClick={onGenerate}
    >
      {generateLabel}
    </Button>
  );

  return (
    <Flex vertical gap={8}>
      {/* STATE: empty — 白纸消解：任务建议 chips，点击即发送 */}
      {messagesEmpty && !streaming && suggestions.length > 0 && (
        <Flex gap={6} wrap>
          {suggestions.map((s) => (
            <Button key={s} size="small" onClick={() => onSend(s)}>
              {s}
            </Button>
          ))}
        </Flex>
      )}

      <Flex gap={8} align="flex-end">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          autoSize={{ minRows: 2, maxRows: 8 }}
          placeholder={placeholder}
          disabled={false}
          style={{ flex: 1 }}
        />
        {streaming ? (
          /* STATE: submitting — 行业共识：Stop 常驻输入区 */
          <Tooltip title="停止生成（已产出的文字保留）">
            <Button danger icon={<StopOutlined />} onClick={onCancel}>
              停止
            </Button>
          </Tooltip>
        ) : (
          <Tooltip title="Enter 发送">
            <Button
              type="primary"
              icon={<SendOutlined />}
              disabled={!input.trim()}
              onClick={send}
            >
              发送
            </Button>
          </Tooltip>
        )}
      </Flex>

      {generateSlot ? (
        <Flex gap={8} justify="flex-end">
          {generateSlot}
        </Flex>
      ) : (
        <Flex justify="flex-end">
          {canGenerate || !generateBlockReason ? (
            generateBtn
          ) : (
            <Tooltip title={generateBlockReason}>{generateBtn}</Tooltip>
          )}
        </Flex>
      )}
    </Flex>
  );
}
