/* ================================================
   FLOW: 写作主循环工作台 (Writing Workbench)
   SCREEN 1 of 4: 物料状态条（工作台默认态）
   ------------------------------------------------
   ENTRY:  进入任意 Studio 阶段页（idea/outline/beats/chapter）
   EXIT:   灯全绿 → 直接 Composer 生成；有 missing 灯 → 点击展开
           InlineRepairCard（Screen 2）
   BRANCH: 生成中（busy）→ 状态条只读，repair 按钮进入 loading
   ================================================ */
import { Button, Flex, Tag, Tooltip } from "antd";
import {
  CheckCircleFilled,
  ExclamationCircleFilled,
} from "@ant-design/icons";
import type { MaterialKey, MaterialLamp } from "./types";

export type MaterialStatusBarProps = {
  /** buildMaterialLamps() 的产出；idea 页为空数组 → 组件不渲染 */
  lamps: MaterialLamp[];
  /** 正在就地补齐的物料（按钮 loading） */
  repairingKey?: MaterialKey | null;
  /** 点击 missing 灯：打开内联补料卡（不跳页） */
  onRepair?: (lamp: MaterialLamp) => void;
};

/**
 * 本章写作所需上游物料的一行灯条。
 * 替代散落在按钮 disabled 提示 / 空态文案里的「请先去 XX」——
 * 状态前置可见，缺料就地可补。
 */
export function MaterialStatusBar({
  lamps,
  repairingKey = null,
  onRepair,
}: MaterialStatusBarProps) {
  if (!lamps.length) return null;

  return (
    <Flex
      gap={8}
      align="center"
      wrap
      style={{ padding: "6px 10px", fontSize: 12 }}
      role="status"
      aria-label="本章物料状态"
    >
      <span style={{ opacity: 0.55 }}>物料</span>
      {lamps.map((lamp) =>
        lamp.status === "ready" ? (
          /* STATE: default — 齐备，只读绿标 */
          <Tag
            key={lamp.key}
            color="success"
            icon={<CheckCircleFilled />}
            style={{ marginInlineEnd: 0 }}
          >
            {lamp.label}
          </Tag>
        ) : (
          /* STATE: missing — 黄标 + 就地补按钮 */
          <Tooltip key={lamp.key} title={`缺${lamp.label}：点击就地生成，无需切页`}>
            <Tag
              color="warning"
              icon={<ExclamationCircleFilled />}
              style={{ marginInlineEnd: 0, cursor: onRepair ? "pointer" : "default" }}
            >
              {lamp.label}
              <Button
                type="link"
                size="small"
                style={{ paddingInline: 4, height: "auto" }}
                loading={repairingKey === lamp.key}
                disabled={!!repairingKey && repairingKey !== lamp.key}
                onClick={() => onRepair?.(lamp)}
              >
                就地补
              </Button>
            </Tag>
          </Tooltip>
        )
      )}
    </Flex>
  );
}
