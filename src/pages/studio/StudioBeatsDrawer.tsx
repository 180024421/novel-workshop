type Props = {
  open: boolean;
  beats: string;
  onClose: () => void;
};

/** 正文页本章细纲预览抽屉 */
export function StudioBeatsDrawer({ open, beats, onClose }: Props) {
  if (!open || !beats.trim()) return null;
  return (
    <div className="studio-beats-drawer">
      <div className="studio-beats-drawer-head">
        <strong>本章细纲</strong>
        <button type="button" className="btn btn-ghost btn-compact" onClick={onClose}>
          关闭
        </button>
      </div>
      <pre className="studio-beats-drawer-body">{beats}</pre>
    </div>
  );
}
