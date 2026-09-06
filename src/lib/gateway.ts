import type { AppSettings } from "../types";
import { resolveRouteTargets, type ProviderConfig } from "./providerPresets";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmRuntime = {
  providers: ProviderConfig[];
  defaultModel: string;
  stream: boolean;
};

export function humanizeLlmError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/abort|cancel|已取消/i.test(raw)) return "已取消生成。";
  const s = raw.toLowerCase();
  if (/401|unauthorized|invalid.*key|api.?key|鉴权|未授权/.test(s)) {
    return "API Key 无效或未通过校验，请回设置重新粘贴。";
  }
  if (/402|429|quota|rate.?limit|额度|余额|insufficient/.test(s)) {
    return "额度不足或请求太频繁，请稍后再试，或换一家渠道的 Key。";
  }
  if (/403|forbidden/.test(s)) {
    return "该渠道拒绝访问，可换魔搭 / 千问 / 智谱再试。";
  }
  if (/enotfound|econnrefused|network|fetch failed|timeout|超时|network/.test(s)) {
    return "网络不通。若是 NVIDIA 等海外渠道，可能需要 VPN；也可改用国内渠道。";
  }
  if (/请先在「设置」/.test(raw)) return raw;
  if (/全部候选失败/.test(raw)) {
    return "当前启用的渠道都写不出来。请检查 Key，或再启用另一家渠道。\n" + raw.slice(0, 280);
  }
  return raw.length > 220 ? raw.slice(0, 220) + "…" : raw;
}

function newRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function chatOne(
  hit: { provider: ProviderConfig; model: string },
  messages: ChatMessage[],
  opts: {
    stream: boolean;
    temperature?: number;
    maxTokens?: number;
    onDelta?: (t: string) => void;
    signal?: AbortSignal;
  }
): Promise<string> {
  if (opts.signal?.aborted) throw new Error("已取消");

  const requestId = newRequestId();
  const payload = {
    requestId,
    baseUrl: hit.provider.baseUrl,
    apiKey: hit.provider.apiKey,
    model: hit.model,
    messages,
    stream: opts.stream,
    temperature: opts.temperature ?? 0.85,
    max_tokens: opts.maxTokens ?? 8192,
  };

  const onAbort = () => {
    window.moshu?.abortChat?.(requestId);
  };
  if (opts.signal) {
    if (opts.signal.aborted) throw new Error("已取消");
    opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    if (window.moshu?.chat) {
      let off: (() => void) | undefined;
      if (opts.stream && opts.onDelta && window.moshu.onChatDelta) {
        off = window.moshu.onChatDelta(opts.onDelta);
      }
      try {
        const res = await window.moshu.chat(payload);
        if (opts.signal?.aborted) throw new Error("已取消");
        if (!opts.stream && res.content && opts.onDelta) opts.onDelta(res.content);
        return res.content;
      } finally {
        off?.();
      }
    }

    const url = `${hit.provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hit.provider.apiKey}`,
      },
      body: JSON.stringify({
        model: hit.model,
        messages,
        stream: opts.stream,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`上游 ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!opts.stream) {
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content ?? "";
      if (content && opts.onDelta) opts.onDelta(content);
      return content;
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("无法读取流");
    const decoder = new TextDecoder("utf-8");
    let full = "";
    let buffer = "";
    while (true) {
      if (opts.signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new Error("已取消");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data)?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            opts.onDelta?.(delta);
          }
        } catch {
          /* ignore */
        }
      }
    }
    return full;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export async function chatCompletion(
  runtime: LlmRuntime | AppSettings,
  messages: ChatMessage[],
  opts?: {
    model?: string;
    onDelta?: (text: string) => void;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    providers?: ProviderConfig[];
    signal?: AbortSignal;
  }
): Promise<string> {
  const providers =
    opts?.providers ||
    ("providers" in runtime && Array.isArray((runtime as LlmRuntime).providers)
      ? (runtime as LlmRuntime).providers
      : []);
  const route = opts?.model || ("defaultModel" in runtime ? runtime.defaultModel : "小说") || "小说";
  const useStream =
    opts?.stream ?? ("stream" in runtime ? runtime.stream !== false : true);

  const targets = resolveRouteTargets(route, providers);
  if (!targets.length) {
    throw new Error("请先配置一张 API Key（设置或启动向导里粘贴即可）");
  }

  const errors: string[] = [];
  for (const hit of targets) {
    if (opts?.signal?.aborted) throw new Error("已取消");
    try {
      return await chatOne(hit, messages, {
        stream: useStream,
        temperature: opts?.temperature,
        maxTokens: opts?.maxTokens,
        onDelta: opts?.onDelta,
        signal: opts?.signal,
      });
    } catch (e) {
      if (opts?.signal?.aborted || /已取消|AbortError/i.test(e instanceof Error ? e.message : "")) {
        throw new Error("已取消");
      }
      errors.push(`${hit.provider.name}/${hit.model}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(`全部候选失败：\n${errors.slice(0, 4).join("\n")}`);
}

export function providersReady(providers: ProviderConfig[]): boolean {
  return providers.some((p) => p.enabled && p.apiKey.trim());
}
