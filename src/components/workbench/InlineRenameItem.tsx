/**
 * ================================================
 * FLOW: Chapter Catalog Sidebar（章目录侧栏）
 * SCREEN 3 of 3: Inline Rename（列表项内联改名）
 * ------------------------------------------------
 * ENTRY:  Screen 2 hover ··· 菜单 →「重命名」
 * EXIT:   Enter/失焦 提交 → onCommit → Screen 1（列表刷新）
 * BRANCH: Esc → onCancel → Screen 1（还原原标题）
 * ================================================
 */
import { useEffect, useRef, useState } from "react";
import { Input } from "antd";
export type InlineRenameItemProps = {
  initialTitle: string;
  /** 提交中（磁盘写）→ 输入框禁用防重复回车 */
  committing: boolean;
  onCommit: (title: string) => void;
  onCancel: () => void;
};

export function InlineRenameItem({
  initialTitle,
  committing,
  onCommit,
  onCancel,
}: InlineRenameItemProps) {
  const [value, setValue] = useState(initialTitle);
  const inputElRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // 聚焦并全选，直接进入改名态（行业共识：不弹窗）
    const el = inputElRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  function submit() {
    const t = value.trim();
    if (!t || t === initialTitle.trim()) {
      onCancel();
      return;
    }
    onCommit(t);
  }

  return (
    /* STATE: default — 自动聚焦全选，Enter 保存 / Esc 还原 */
    /* STATE: submitting — committing=true，输入框禁用防重复提交 */
    <Input
      size="small"
      className="wsb-rename"
      value={value}
      disabled={committing}
      onChange={(e) => setValue(e.target.value)}
      onPressEnter={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => {
        if (!committing) onCancel();
      }}
      ref={(inst) => {
        const dom = (inst as unknown as { input?: HTMLInputElement } | null)?.input;
        inputElRef.current = dom ?? null;
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
