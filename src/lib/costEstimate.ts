/** 粗估费用：按「字符数/4 ≈ token」经验公式 */

export type PriceRow = {
  providerId: string;
  label: string;
  /** 元 / 1K tokens（输入+输出平均粗算） */
  cnyPer1k: number;
};

export const DEFAULT_PRICES: PriceRow[] = [
  { providerId: "ModelScope", label: "魔搭", cnyPer1k: 0 },
  { providerId: "DashScope", label: "千问", cnyPer1k: 0.004 },
  { providerId: "Zhipu", label: "智谱", cnyPer1k: 0.005 },
  { providerId: "DeepSeek", label: "DeepSeek", cnyPer1k: 0.002 },
  { providerId: "OpenAI", label: "OpenAI", cnyPer1k: 0.05 },
  { providerId: "custom", label: "自建/其他", cnyPer1k: 0.01 },
];

export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function estimateCostCny(charsIn: number, charsOut: number, cnyPer1k: number): number {
  const tokens = estimateTokens(charsIn) + estimateTokens(charsOut);
  return (tokens / 1000) * cnyPer1k;
}

export function formatCny(n: number): string {
  if (n <= 0) return "≈ ¥0（免费或未标价）";
  if (n < 0.01) return `≈ ¥${n.toFixed(4)}`;
  return `≈ ¥${n.toFixed(2)}`;
}

export async function loadPrices(
  join: (...p: string[]) => Promise<string>,
  userDataJoin?: () => Promise<string>
): Promise<PriceRow[]> {
  void join;
  void userDataJoin;
  try {
    const raw = localStorage.getItem("moshu.prices");
    if (raw) return JSON.parse(raw) as PriceRow[];
  } catch {
    /* ignore */
  }
  return DEFAULT_PRICES;
}

export function savePrices(rows: PriceRow[]) {
  localStorage.setItem("moshu.prices", JSON.stringify(rows));
}

export function pickPrice(
  rows: PriceRow[],
  providerId?: string
): PriceRow {
  return (
    rows.find((r) => r.providerId === providerId) ||
    rows.find((r) => r.providerId === "custom") ||
    DEFAULT_PRICES[DEFAULT_PRICES.length - 1]
  );
}
