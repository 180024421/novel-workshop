import { useMemo, useState } from "react";
import { confirmOverwrite } from "../lib/confirm";
import { restoreBackup, type BackupMeta } from "../lib/backup";
import {
  acceptAllRight,
  applyChunks,
  DIFF_CHAR_SOFT_LIMIT,
  diffParagraphs,
  type DiffChunk,
} from "../lib/textDiff";

type Props = {
  open: boolean;
  onClose: () => void;
  root: string;
  join: (...p: string[]) => Promise<string>;
  leftLabel: string;
  leftText: string;
  rightText: string;
  onApply: (next: string) => void;
  /** 可选：整章用备份覆盖时的 meta */
  backupMeta?: BackupMeta | null;
};

export function ChapterDiffDrawer(props: Props) {
  const {
    open,
    onClose,
    root,
    join,
    leftLabel,
    leftText,
    rightText,
    onApply,
    backupMeta,
  } = props;
  const [mode, setMode] = useState<"side" | "unified">("side");
  const [accepted, setAccepted] = useState<number[]>([]);

  const overSoftLimit = leftText.length + rightText.length > DIFF_CHAR_SOFT_LIMIT;
  const chunks = useMemo(() => diffParagraphs(leftText, rightText), [leftText, rightText]);
  const changeIndexes = useMemo(
    () => chunks.map((c, i) => (c.type === "equal" ? -1 : i)).filter((i) => i >= 0),
    [chunks]
  );

  if (!open) return null;

  function toggle(idx: number) {
    setAccepted((prev) => (prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]));
  }

  function applySelected() {
    const next = applyChunks(leftText, rightText, chunks, accepted);
    onApply(next);
  }

  async function applyAllRight() {
    if (!(await confirmOverwrite("全部采纳当前正文（右侧）覆盖对比结果"))) return;
    onApply(acceptAllRight(rightText));
    onClose();
  }

  async function restoreWhole() {
    if (!backupMeta) return;
    if (!(await confirmOverwrite("用备份整章覆盖当前正文"))) return;
    const text = await restoreBackup(root, join, backupMeta);
    onApply(text);
    onClose();
  }

  return (
    <div className="diff-drawer-backdrop" role="dialog" aria-modal="true">
      <div className="diff-drawer">
        <div className="diff-drawer-head row" style={{ justifyContent: "space-between" }}>
          <strong>{leftLabel.includes("润色") ? "改前 / 改后 Diff" : "对比备份"}</strong>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn btn-ghost btn-compact ${mode === "side" ? "active" : ""}`}
              onClick={() => setMode("side")}
            >
              并排
            </button>
            <button
              type="button"
              className={`btn btn-ghost btn-compact ${mode === "unified" ? "active" : ""}`}
              onClick={() => setMode("unified")}
            >
              统一
            </button>
            <button type="button" className="btn btn-ghost btn-compact" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          左：{leftLabel} · 右：当前正文 · 勾选变更块后「采纳所选」
        </p>
        {overSoftLimit ? (
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
            过长已整章对比
          </p>
        ) : null}
        <div className={`diff-body ${mode === "side" ? "diff-side" : "diff-unified"}`}>
          {chunks.map((c, i) => (
            <DiffBlock
              key={i}
              chunk={c}
              index={i}
              mode={mode}
              checked={accepted.includes(i)}
              onToggle={() => toggle(i)}
            />
          ))}
        </div>
        <div className="diff-drawer-foot row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => setAccepted(changeIndexes)}
          >
            全选变更
          </button>
          <button type="button" className="btn btn-primary btn-compact" onClick={applySelected}>
            采纳所选
          </button>
          <button type="button" className="btn btn-ghost btn-compact" onClick={() => void applyAllRight()}>
            全部用当前正文
          </button>
          {backupMeta && (
            <button type="button" className="btn btn-ghost btn-compact" onClick={() => void restoreWhole()}>
              整章用备份覆盖
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DiffBlock(props: {
  chunk: DiffChunk;
  index: number;
  mode: "side" | "unified";
  checked: boolean;
  onToggle: () => void;
}) {
  const { chunk: c, index, mode, checked, onToggle } = props;
  const changeable = c.type !== "equal";
  if (mode === "unified") {
    return (
      <div className={`diff-chunk diff-${c.type}`}>
        {changeable && (
          <label className="diff-check">
            <input type="checkbox" checked={checked} onChange={onToggle} />
            <span>{c.type}</span>
          </label>
        )}
        {c.type === "equal" && <pre className="diff-pre">{c.left}</pre>}
        {c.type === "del" && <pre className="diff-pre diff-del-text">- {c.left}</pre>}
        {c.type === "add" && <pre className="diff-pre diff-add-text">+ {c.right}</pre>}
        {c.type === "replace" && (
          <>
            <pre className="diff-pre diff-del-text">- {c.left}</pre>
            <pre className="diff-pre diff-add-text">+ {c.right}</pre>
          </>
        )}
      </div>
    );
  }
  return (
    <div className={`diff-chunk-side diff-${c.type}`}>
      <div className="diff-col">
        {(c.type === "equal" || c.type === "del" || c.type === "replace") && (
          <pre className="diff-pre">{c.left || ""}</pre>
        )}
      </div>
      <div className="diff-col">
        {changeable && (
          <label className="diff-check">
            <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`采纳块 ${index}`} />
          </label>
        )}
        {(c.type === "equal" || c.type === "add" || c.type === "replace") && (
          <pre className="diff-pre">{c.right || ""}</pre>
        )}
      </div>
    </div>
  );
}
