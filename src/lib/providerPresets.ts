export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  signup?: string;
  note?: string;
  region?: "cn" | "vpn";
};

/** 用途路由 → 上游模型候选（对齐大帅网关常用「小说」等） */
export const ROUTE_CANDIDATES: Record<string, string[]> = {
  小说: [
    "Qwen/Qwen3.5-122B-A10B",
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "qwen3.5-plus",
    "glm-4.7-flash",
    "glm-4.5-flash",
    "deepseek-v4-flash",
    "deepseek-ai/DeepSeek-V4-Flash-0731",
    "sensenova-6.8-flash-lite",
    "nvidia/nemotron-3-super-120b-a12b",
  ],
  长文: [
    "Qwen/Qwen3.5-122B-A10B",
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "qwen3.5-plus",
    "nvidia/nemotron-3-super-120b-a12b",
  ],
  复杂: [
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "qwen3.8-max",
    "deepseek-ai/DeepSeek-V4-Pro",
    "deepseek-v4-pro",
    "glm-5.2",
  ],
  日常: [
    "qwen3.5-flash",
    "qwen-flash",
    "glm-4.5-flash",
    "deepseek-v4-flash",
    "sensenova-6.8-flash-lite",
  ],
  总结: ["qwen-flash", "glm-4.5-flash", "qwen3.5-flash", "deepseek-v4-flash"],
};

export const PROVIDER_PRESETS: Omit<ProviderConfig, "apiKey" | "enabled">[] = [
  {
    id: "ModelScope",
    name: "魔搭 ModelScope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    models: [
      "Qwen/Qwen3.5-122B-A10B",
      "Qwen/Qwen3-235B-A22B-Instruct-2507",
      "deepseek-ai/DeepSeek-V4-Flash-0731",
      "deepseek-ai/DeepSeek-V4-Pro",
      "Qwen/Qwen3.5-27B",
      "Qwen/Qwen3-8B",
    ],
    signup: "https://modelscope.cn/my/myaccesstoken",
    note: "国内直连，日额度友好",
    region: "cn",
  },
  {
    id: "DashScope",
    name: "千问 DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      "qwen3.8-max",
      "qwen3.5-plus",
      "qwen3.5-flash",
      "qwen-plus",
      "qwen-flash",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "glm-5.2",
    ],
    signup: "https://platform.qianwenai.com/home/",
    note: "新人常有免费额度；用通用 sk- Key",
    region: "cn",
  },
  {
    id: "Zhipu",
    name: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-5.2", "glm-4.7", "glm-4.7-flash", "glm-4.5-flash"],
    signup: "https://open.bigmodel.cn/usercenter/apikeys",
    note: "Flash 有免费额度；整段 id.secret",
    region: "cn",
  },
  {
    id: "SenseNova",
    name: "商汤 SenseNova",
    baseUrl: "https://token.sensenova.cn/v1",
    models: ["sensenova-6.8-flash-lite", "deepseek-v4-flash", "glm-5.2"],
    signup: "https://console.sensenova.cn/",
    note: "Token Plan",
    region: "cn",
  },
  {
    id: "Doubao",
    name: "豆包 · 火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seed-1-6-251015", "doubao-lite-32k-240828"],
    signup: "https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement",
    note: "模型名可为接入点 ep-",
    region: "cn",
  },
  {
    id: "Hunyuan",
    name: "混元",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    models: ["hunyuan-turbos-latest", "hunyuan-lite", "hunyuan-turbo"],
    signup: "https://console.cloud.tencent.com/hunyuan/api-key",
    note: "hunyuan-lite 常有免费额度",
    region: "cn",
  },
  {
    id: "NVIDIA",
    name: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    models: [
      "nvidia/nemotron-3-super-120b-a12b",
      "meta/llama-3.3-70b-instruct",
      "minimaxai/minimax-m3",
    ],
    signup: "https://build.nvidia.com/",
    note: "日额度；建议 VPN",
    region: "vpn",
  },
  {
    id: "SiliconFlow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen3.5-9B", "Qwen/Qwen3-8B", "deepseek-ai/DeepSeek-V3"],
    signup: "https://cloud.siliconflow.cn/account/ak",
    note: "小杯免费兜底",
    region: "cn",
  },
  {
    id: "OpenRouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["openrouter/free", "google/gemma-4-31b-it:free"],
    signup: "https://openrouter.ai/keys",
    note: "免费池兜底；建议 VPN",
    region: "vpn",
  },
];

export function defaultProviders(): ProviderConfig[] {
  return PROVIDER_PRESETS.map((p) => ({
    ...p,
    apiKey: "",
    enabled: false,
  }));
}

export function detectPasteTarget(paste: string): { providerId: string; key: string } | null {
  const key = paste.trim();
  if (!key) return null;
  if (key.startsWith("nvapi-")) return { providerId: "NVIDIA", key };
  if (key.startsWith("ms-")) return { providerId: "ModelScope", key };
  if (/^[a-f0-9]{8}\.[a-zA-Z0-9]+/.test(key) || (key.includes(".") && !key.startsWith("sk-") && key.length > 40))
    return { providerId: "Zhipu", key };
  if (key.startsWith("sk-")) return { providerId: "DashScope", key };
  return null;
}

export type ResolveHit = { provider: ProviderConfig; model: string };

/** 按路由名解析可用 (渠道, 模型)；优先命中已启用渠道真实拥有的模型 */
export function resolveRouteTargets(
  routeOrModel: string,
  providers: ProviderConfig[]
): ResolveHit[] {
  const enabled = providers.filter((p) => p.enabled && p.apiKey.trim() && p.baseUrl.trim());
  if (!enabled.length) return [];

  const candidates = ROUTE_CANDIDATES[routeOrModel] || [routeOrModel];
  const hits: ResolveHit[] = [];

  for (const model of candidates) {
    for (const provider of enabled) {
      if (provider.models.includes(model)) hits.push({ provider, model });
    }
  }

  if (!hits.length) {
    for (const provider of enabled) {
      if (provider.models.length === 0) {
        hits.push({ provider, model: candidates[0] || routeOrModel });
      } else {
        hits.push({ provider, model: provider.models[0] });
      }
    }
  }

  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${h.provider.id}::${h.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
