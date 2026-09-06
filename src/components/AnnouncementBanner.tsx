import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dismissAnnouncement,
  filterAnnouncements,
  loadDismissedIds,
  pickForceAnnouncements,
  type Announcement,
  type AppMetaPayload,
  type MaintenanceInfo,
} from "../lib/appMeta";

type Props = {
  versionCode: number;
  meta: AppMetaPayload | null;
  onRefresh?: () => void;
  forceUpdate?: boolean;
  forceUpdateHint?: string;
  onDownloadUpdate?: () => void;
};

export function AnnouncementBanner(props: Props) {
  const { versionCode, meta, forceUpdate, forceUpdateHint, onDownloadUpdate } = props;
  const [dismissed, setDismissed] = useState<string[]>(() => loadDismissedIds());
  const [forceQueue, setForceQueue] = useState<Announcement[]>([]);
  const [forceAck, setForceAck] = useState<string | null>(null);

  const visible = useMemo(() => {
    const list = filterAnnouncements({
      announcements: meta?.announcements || [],
      versionCode,
      dismissedIds: dismissed,
    });
    return list;
  }, [meta, versionCode, dismissed]);

  useEffect(() => {
    const forced = pickForceAnnouncements(visible).filter((a) => a.id !== forceAck);
    setForceQueue(forced);
  }, [visible, forceAck]);

  const maintenance: MaintenanceInfo | undefined = meta?.maintenance;
  const bannerItems = visible.filter((a) => !a.force && a.level !== "critical").slice(0, 3);
  const currentForce = forceQueue[0];

  const onDismiss = useCallback((id: string) => {
    setDismissed(dismissAnnouncement(id));
  }, []);

  return (
    <>
      {forceUpdate && (
        <div
          className="panel"
          style={{
            margin: "8px 12px 0",
            borderColor: "var(--danger, #c44)",
            background: "rgba(180,40,40,0.12)",
          }}
        >
          <strong>必须更新后才能继续生成</strong>
          <p className="muted" style={{ margin: "6px 0", fontSize: 13 }}>
            {forceUpdateHint || "检测到强制更新，请先下载安装新版本。仍可打开与阅读书稿。"}
          </p>
          {onDownloadUpdate && (
            <button type="button" className="btn btn-primary" onClick={onDownloadUpdate}>
              下载更新
            </button>
          )}
        </div>
      )}

      {maintenance?.enabled && (
        <div
          className="panel"
          style={{
            margin: "8px 12px 0",
            borderColor: "var(--warn, #c90)",
            background: "rgba(180,140,40,0.12)",
          }}
        >
          <strong>维护模式</strong>
          <p className="muted" style={{ margin: "6px 0", fontSize: 13 }}>
            {maintenance.message || "服务维护中，生成功能暂时不可用。仍可打开书稿。"}
          </p>
        </div>
      )}

      {bannerItems.map((a) => (
        <div
          key={a.id}
          className="panel row"
          style={{
            margin: "8px 12px 0",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <strong>{a.title || "公告"}</strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>
              {a.body}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-compact" onClick={() => onDismiss(a.id)}>
            不再显示
          </button>
        </div>
      ))}

      {currentForce && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div className="panel stack" style={{ maxWidth: 520, width: "100%" }}>
            <h3 style={{ margin: 0 }}>{currentForce.title || "重要公告"}</h3>
            <p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6 }}>{currentForce.body}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setForceAck(currentForce.id);
                if (!currentForce.force && currentForce.level !== "critical") {
                  onDismiss(currentForce.id);
                }
              }}
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </>
  );
}
