import { useEffect, useState } from "react";
import {
  registerConfirmHandler,
  settleConfirm,
  type ConfirmRequest,
} from "../lib/confirm";

/** 全局应用内确认 / 输入条（替代 window.confirm / prompt） */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    registerConfirmHandler((next) => {
      if (next?.kind === "prompt") setInput(next.defaultValue || "");
      setReq(next);
    });
    return () => registerConfirmHandler(null);
  }, []);

  if (!req) return null;

  function finish(value: boolean | string | null) {
    settleConfirm(value);
  }

  return (
    <div className="confirm-host-overlay" role="presentation">
      <div
        className="cost-confirm-bar panel confirm-host-bar"
        role="dialog"
        aria-modal="true"
        aria-label={req.kind === "prompt" ? "输入" : "确认"}
      >
        <div className="muted" style={{ fontSize: 13, flex: 1 }}>
          {req.message}
          {req.kind === "prompt" && (
            <input
              className="input"
              style={{ display: "block", width: "100%", marginTop: 8 }}
              value={input}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") finish(input);
                if (e.key === "Escape") finish(null);
              }}
            />
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => finish(req.kind === "prompt" ? null : false)}
          >
            {req.cancelLabel || "取消"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-compact"
            onClick={() => finish(req.kind === "prompt" ? input : true)}
          >
            {req.confirmLabel || "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
