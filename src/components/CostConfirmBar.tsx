type Props = {
  hint: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** 应用内费用确认条（替代 window.confirm） */
export function CostConfirmBar(props: Props) {
  return (
    <div className="cost-confirm-bar panel" role="dialog" aria-label="费用确认">
      <div className="muted" style={{ fontSize: 12, flex: 1 }}>
        {props.hint}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn btn-ghost btn-compact" onClick={props.onCancel}>
          {props.cancelLabel || "取消"}
        </button>
        <button type="button" className="btn btn-primary btn-compact" onClick={props.onConfirm}>
          {props.confirmLabel || "确认写"}
        </button>
      </div>
    </div>
  );
}
