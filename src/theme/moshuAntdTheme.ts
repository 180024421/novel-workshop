import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";

/**
 * antd 暗色主题 —— 对齐墨枢现有 styles.css :root 变量。
 * 改配色请两边同步：--gold ≈ colorPrimary，--bg-panel ≈ colorBgContainer。
 */
export const moshuAntdTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    // 品牌色（--gold）
    colorPrimary: "#d4a574",
    colorInfo: "#d4a574",
    colorSuccess: "#7cbc8e", // --ok
    colorError: "#e07a6a", // --danger
    colorWarning: "#e8c9a0", // --gold-bright

    // 墨黑层级（--bg / --bg-panel / --bg-soft）
    colorBgBase: "#000000",
    colorBgContainer: "#121212",
    colorBgElevated: "#1a1a1a",
    colorBgLayout: "#0d0d0d",
    colorBgSpotlight: "#1a1a1a",

    // 文字（--text / --muted）
    colorText: "#ffffff",
    colorTextSecondary: "#b0b0b0",
    colorTextTertiary: "rgba(255, 255, 255, 0.45)",

    // 描边（--line / --line-strong）
    colorBorder: "rgba(255, 255, 255, 0.12)",
    colorBorderSecondary: "rgba(255, 255, 255, 0.08)",

    fontFamily: '"Instrument Sans", "Segoe UI", sans-serif',
    borderRadius: 10,
  },
  components: {
    Modal: { contentBg: "#121212", headerBg: "#121212" },
    Dropdown: { paddingBlock: 6 },
    Progress: { defaultColor: "#d4a574" },
  },
};
