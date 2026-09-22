/* ================================================
   FLOW: 写作主循环工作台 (Writing Workbench)
   SCREEN 2 of 4: 缺料就地补态（内联补料卡）
   ------------------------------------------------
   ENTRY:  Screen 1 点击 missing 灯「就地补」
   EXIT:   流式完成 → 灯转绿 → done 态「继续写正文」一键接续
           （F4：花费动作仍由用户点，不静默自动生成）
   BRANCH: 「稍后」→ 收起卡片，回到原页面；失败 → 卡片转错误态可重试
   ================================================ */
import { Alert, Button, Flex, Typography } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import type { MaterialLamp } from "./types";

export type InlineRepairCardProps = {
  lamp: MaterialLamp;
  /** 该物料是否正在生成 */
  generating: boolean;
  /** 生成失败原因（非空即错误态） */
  error?: string | null;
  /** 补料完成后展示的一句话摘要（字数等） */
  resultHint?: string | null;
  /** 补齐后的一键接续（父层按 mode 决定是否给；不给则 done 态只收起） */
  onResume?: () => void;
  onGenerate: (lamp: MaterialLamp) => void;
  onDismiss: () => void;
};

function repairLabel(action?: MaterialLamp["repairAction"]): string {
  if (action === "gen-setup") return "就地生成设定";
  if (action === "gen-outline") return "就地生成总纲";
  if (action === "gen-beats") return "就地补本章细纲";
  return "就地生成";
}

/**
 * 内联补料卡：嵌在右栏 Composer 上方，替代「请先去细纲补本章」跳页。
 * 补齐后灯条转绿；正文页由父层传 onResume 提供「继续写正文」一键接续（不静默烧钱）。
 */
export function InlineRepairCard({
  lamp,
  generating,
  error,
  resultHint,
  onResume,
  onGenerate,
  onDismiss,
}: InlineRepairCardProps) {
  if (resultHint && !error && !generating) {
    /* STATE: done — 已补齐（灯条转绿由父级重算），一键接续或收起 */
    return (
      <Alert
        type="success"
        showIcon
        message={`${lamp.label}已就绪`}
        description={resultHint}
        style={{ marginBottom: 8 }}
        action={
          <Flex gap={6}>
            {onResume && (
              <Button size="small" type="primary" onClick={onResume}>
                {lamp.key === "beats" ? "继续写正文" : "继续生成"}
              </Button>
            )}
            <Button size="small" type="text" onClick={onDismiss}>
              收起
            </Button>
          </Flex>
        }
      />
    );
  }

  return (
    <Alert
      type={error ? "error" : "warning"}
      showIcon
      /* STATE: default — 缺料说明 + 就地生成 CTA */
      /* STATE: submitting — generating=true，按钮 loading，禁关闭以外的操作 */
      /* STATE: error — 失败原因内联展示（不 Toast），可重试 */
      message={`缺少${lamp.label}${error ? "：生成失败" : ""}`}
      description={
        error ? (
          error
        ) : (
          <>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              {lamp.key === "beats"
                ? "正文将按补出的细纲展开；补完后点「继续写正文」即可，无需切页。"
                : `将从上游已有内容直接生成${lamp.label}，补完灯条转绿后即可继续。`}
            </Typography.Paragraph>
            <Flex gap={8}>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={generating}
                onClick={() => onGenerate(lamp)}
              >
                {repairLabel(lamp.repairAction)}
              </Button>
              <Button type="text" disabled={generating} onClick={onDismiss}>
                稍后
              </Button>
            </Flex>
          </>
        )
      }
      action={
        error ? (
          <Button size="small" onClick={() => onGenerate(lamp)}>
            重试
          </Button>
        ) : undefined
      }
      style={{ marginBottom: 8 }}
    />
  );
}
