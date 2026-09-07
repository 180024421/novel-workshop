import { alignBeatsToBody, type BeatAlignRow } from "../../lib/beatsAlign";
import { useMemo } from "react";

type Props = {
  open: boolean;
  beats: string;
  body?: string;
  onClose: () => void;
};

/** 正文页本章细纲预览抽屉（含场次对齐） */
export function StudioBeatsDrawer({ open, beats, body = "", onClose }: Props) {
  const rows: BeatAlignRow[] = useMemo(
    () => (open && beats.trim() ? alignBeatsToBody(beats, body) : []),
    [open, beats, body]
  );

  if (!open || !beats.trim()) return null;
  return (
    <div className="studio-beats-drawer">
      <div className="studio-beats-drawer-head">
        <strong>本章细纲</strong>
        <button type="button" className="btn btn-ghost btn-compact" onClick={onClose}>
          关闭
        </button>
      </div>
      {rows.length > 0 && (
        <div className="scan-box" style={{ margin: "0 0 8px", maxHeight: 160, overflow: "auto" }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
            场次对齐
          </div>
          {rows.map((row, i) => (
            <div key={`${row.title}-${i}`} className="scan-hit" style={{ fontSize: 12, marginBottom: 4 }}>
              <strong style={{ color: row.covered ? "var(--ok, #2a7)" : "var(--danger)" }}>
                {row.covered ? "✓" : "✗"}
              </strong>{" "}
              {row.title}
            </div>
          ))}
        </div>
      )}
      <pre className="studio-beats-drawer-body">{beats}</pre>
    </div>
  );
}
