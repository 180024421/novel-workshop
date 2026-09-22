/**
 * ================================================
 * FLOW: Chapter Catalog Sidebar（章目录侧栏）
 * SCREEN 1 of 3: 章列表（按卷分组 + 状态角标）
 * SCREEN 2 of 3: hover ··· 菜单（重命名 / 移动到卷 / 从目录移除）
 * ------------------------------------------------
 * ENTRY:  AppLayout 侧栏挂载（Phase C 集成，替换现有 chapter-nav 区）
 * EXIT:   点章 → onSelect（父层先 flush 保存再切章）→ 工作台 Flow A
 * BRANCH: ···菜单「重命名」→ Screen 3 内联改名
 *         ···菜单「从目录移除」→ modal 二次确认 → 撤销 notification
 * ================================================
 * 铁律对照（AI Product 场景）：
 * - 新章生成完 ≤1s 出现：父层监听 CHAPTERS_DIRTY_EVENT 重算 rows（修旧版只随 volumeId 重算的问题）
 * - 破坏性操作（移除目录）才有阻断确认；重命名/移动不弹窗
 */
import { useMemo, useState, type CSSProperties, type Ref } from "react";
import { App as AntdApp, Button, Dropdown, Input } from "antd";
import type { MenuProps } from "antd";
import { DeleteOutlined, EditOutlined, FolderOutlined, MoreOutlined } from "@ant-design/icons";
import { LoadingOutlined } from "@ant-design/icons";
import { CHAPTER_BADGE_META, chapterBadgeState, chapterNum } from "./chapterOps";
import { InlineRenameItem } from "./InlineRenameItem";
import type { ChapterItemState, ChapterRowView } from "./types";
import "./ChapterSidebar.css";

export type ChapterSidebarProps = {
  /** projectProgress.chapterRows 直接透传 */
  rows: ChapterRowView[];
  /** 卷清单（含 0 章新卷），来自 prog.volumeRows */
  volumes: { id: string; title: string }[];
  activeChapterId: string;
  /** 队列进行态覆盖：generating/queued/failed —— Flow C 接入点 */
  stateOverrides?: Record<string, Extract<ChapterItemState, "generating" | "queued" | "failed">>;
  /** 父层负责：先 flush 自动保存再切章 */
  onSelect: (row: ChapterRowView) => void;
  onRename: (row: ChapterRowView, newTitle: string) => Promise<void>;
  onMove: (row: ChapterRowView, toVolumeId: string) => Promise<void>;
  /** 从目录移除（正文保留） */
  onDelete: (row: ChapterRowView) => Promise<void>;
  /** 撤销移除 */
  onUndoDelete: (row: ChapterRowView) => Promise<void>;
  /** 空卷引导：就地触发本卷细纲生成，不跳页 */
  onGenerateVolumeBeats?: (volumeId: string) => void;
  onAddChapter?: () => void;
  /** 父层滚动定位用（当前章滚入可视区） */
  listRef?: Ref<HTMLDivElement>;
};

export function ChapterSidebar(p: ChapterSidebarProps) {
  const { modal, notification } = AntdApp.useApp();
  const [filter, setFilter] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [committingId, setCommittingId] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();

  /** 按卷分组（卷号升序），0 章卷也保留以承载空状态引导 */
  const groups = useMemo(() => {
    const byVol = new Map<string, ChapterRowView[]>();
    for (const r of p.rows) {
      const vid = r.volumeId || "第1卷";
      if (!byVol.has(vid)) byVol.set(vid, []);
      byVol.get(vid)!.push(r);
    }
    const volIds = new Set<string>([...p.volumes.map((v) => v.id), ...byVol.keys()]);
    return [...volIds]
      .sort((a, b) => (chapterNum(a) ?? 0) - (chapterNum(b) ?? 0))
      .map((vid) => ({
        volumeId: vid,
        title: p.volumes.find((v) => v.id === vid)?.title || vid,
        chapters: (byVol.get(vid) || [])
          .slice()
          .sort((a, b) => (chapterNum(a.id) ?? 0) - (chapterNum(b.id) ?? 0)),
      }));
  }, [p.rows, p.volumes]);

  function rowMenu(r: ChapterRowView, busy: boolean): MenuProps["items"] {
    const moveTargets = p.volumes
      .filter((v) => v.id !== r.volumeId)
      .map((v) => ({ key: `move:${v.id}`, label: `${v.id} ${v.title !== v.id ? v.title : ""}` }));
    return [
      { key: "rename", icon: <EditOutlined />, label: "重命名", disabled: busy },
      {
        key: "move",
        icon: <FolderOutlined />,
        label: "移动到卷",
        disabled: busy || !moveTargets.length,
        children: moveTargets,
      },
      { type: "divider" },
      { key: "delete", icon: <DeleteOutlined />, label: "从目录移除", danger: true, disabled: busy },
    ];
  }

  async function handleMenuKey(key: string, r: ChapterRowView) {
    if (key === "rename") {
      setRenamingId(r.id);
      return;
    }
    if (key.startsWith("move:")) {
      const to = key.slice(5);
      try {
        await p.onMove(r, to);
      } catch (e) {
        notification.error({
          message: "移动失败",
          description: e instanceof Error ? e.message : String(e),
          placement: "bottomLeft",
        });
      }
      return;
    }
    if (key === "delete") {
      // 仅破坏性操作配阻断确认（场景铁律）；正文文件不删，可撤销
      modal.confirm({
        title: `从目录移除「${r.id} ${r.title}」？`,
        content: "只移除章目录条目，正文文件保留；6 秒内可撤销。",
        okText: "移除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
          try {
            await p.onDelete(r);
            notification.open({
              message: `已移除 ${r.id}`,
              description: "正文文件未删除",
              placement: "bottomLeft",
              duration: 6,
              btn: (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => {
                    void p.onUndoDelete(r);
                    notification.destroy(`undo:${r.id}`);
                  }}
                >
                  撤销
                </Button>
              ),
              key: `undo:${r.id}`,
            });
          } catch (e) {
            notification.error({
              message: "移除失败",
              description: e instanceof Error ? e.message : String(e),
              placement: "bottomLeft",
            });
          }
        },
      });
    }
  }

  async function commitRename(r: ChapterRowView, newTitle: string) {
    setCommittingId(r.id);
    try {
      await p.onRename(r, newTitle);
      setRenamingId(null);
    } catch (e) {
      notification.error({
        message: "改名失败",
        description: e instanceof Error ? e.message : String(e),
        placement: "bottomLeft",
      });
    } finally {
      setCommittingId(null);
    }
  }

  function badgeOf(r: ChapterRowView) {
    return CHAPTER_BADGE_META[chapterBadgeState(r, p.stateOverrides?.[r.id])];
  }

  return (
    /* STATE: default — 卷分组列表，当前章高亮，hover 出 ··· */
    /* STATE: filtering — 顶部过滤框，跨卷按章号/标题/卷名筛 */
    /* STATE: renaming — 目标行变输入框（Screen 3） */
    /* STATE: empty-volume — 0 章卷显示「生成本卷细纲」就地引导 */
    <div className="wsb" role="navigation" aria-label="章目录">
      <div className="wsb-head">
        <span className="wsb-head-title">章目录</span>
        {p.onAddChapter && (
          <button type="button" className="linkish" onClick={() => void p.onAddChapter?.()}>
            +新建章
          </button>
        )}
      </div>
      {p.rows.length > 6 && (
        <Input
          size="small"
          allowClear
          className="wsb-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤章号/标题…"
          aria-label="过滤章节"
        />
      )}
      <div className="wsb-list" ref={p.listRef}>
        {!p.rows.length && (
          <p className="wsb-empty">
            还没有章节。
            {p.onGenerateVolumeBeats && (
              <Button
                size="small"
                type="link"
                onClick={() => p.onGenerateVolumeBeats?.(p.volumes[0]?.id || "第1卷")}
              >
                生成本卷细纲
              </Button>
            )}
          </p>
        )}
        {groups.map((g) => {
          const shown = g.chapters.filter((r) => {
            if (!q) return true;
            return (
              r.id.toLowerCase().includes(q) ||
              r.title.toLowerCase().includes(q) ||
              g.volumeId.toLowerCase().includes(q)
            );
          });
          if (q && !shown.length) return null;
          return (
            <div key={g.volumeId} className="wsb-group">
              <div className="wsb-group-head">
                {g.volumeId}
                {g.title !== g.volumeId ? ` ${g.title}` : ""}
                <span className="wsb-group-count">{g.chapters.length} 章</span>
              </div>
              {!g.chapters.length && (
                <div className="wsb-group-empty">
                  {p.onGenerateVolumeBeats ? (
                    <Button size="small" type="link" onClick={() => p.onGenerateVolumeBeats?.(g.volumeId)}>
                      生成第 {chapterNum(g.volumeId) ?? "?"} 卷细纲
                    </Button>
                  ) : (
                    <span className="wsb-group-empty-tip">本卷暂无章节</span>
                  )}
                </div>
              )}
              {shown.map((r) => {
                const override = p.stateOverrides?.[r.id];
                const busy = override === "generating";
                const badge = badgeOf(r);
                const on = r.id === p.activeChapterId;
                const dotState = override || (r.hasChapter ? "done" : "draft");
                // F14：形状 + 颜色双通道（色觉异常也可分）：实点/细环/环心点/菱形
                const dotStyle: CSSProperties =
                  dotState === "failed"
                    ? { background: badge.color, borderRadius: 1.5, transform: "rotate(45deg)" }
                    : dotState === "queued"
                      ? {
                          background: `radial-gradient(circle, ${badge.color} 0 28%, transparent 34%)`,
                          boxShadow: `inset 0 0 0 1.5px ${badge.color}`,
                        }
                      : dotState === "draft"
                        ? { background: "transparent", boxShadow: `inset 0 0 0 1.5px ${badge.color}` }
                        : { background: badge.color };
                return (
                  <div
                    key={r.id}
                    className={`wsb-item${on ? " on" : ""}${r.hasChapter ? " done" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-current={on ? "true" : undefined}
                    onClick={() => {
                      if (renamingId !== r.id) p.onSelect(r);
                    }}
                    onKeyDown={(e) => {
                      // F7：Enter/Space 选章（重构前行是 <button>，键盘可达不回退）
                      if (renamingId === r.id) return;
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        p.onSelect(r);
                      }
                    }}
                    title={`${g.volumeId} · ${badge.tip}${r.words ? ` · ${r.words} 字` : ""}${
                      r.hasBeats ? "" : " · 缺细纲"
                    }`}
                  >
                    <span className="wsb-id">{String(chapterNum(r.id) ?? "")}</span>
                    {renamingId === r.id ? (
                      <InlineRenameItem
                        initialTitle={r.title}
                        committing={committingId === r.id}
                        onCommit={(t) => void commitRename(r, t)}
                        onCancel={() => setRenamingId(null)}
                      />
                    ) : (
                      <span className="wsb-title">
                        {!r.hasBeats && <span className="wsb-lack">⚠</span>}
                        {r.title}
                      </span>
                    )}
                    <span className="wsb-badge" aria-label={badge.label}>
                      {override === "generating" ? (
                        <LoadingOutlined style={{ color: badge.color }} spin />
                      ) : (
                        <span className={`wsb-dot wsb-dot-${dotState}`} style={dotStyle} />
                      )}
                    </span>
                    {renamingId !== r.id && (
                      <Dropdown
                        trigger={["hover", "click"]}
                        placement="bottomRight"
                        menu={{
                          items: rowMenu(r, busy),
                          onClick: ({ key }) => void handleMenuKey(key, r),
                        }}
                      >
                        <button
                          type="button"
                          className="wsb-more"
                          aria-label={`${r.id} 操作菜单`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreOutlined />
                        </button>
                      </Dropdown>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
