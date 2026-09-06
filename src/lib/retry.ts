export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; delayMs?: number; signal?: AbortSignal; onRetry?: (n: number, e: unknown) => void }
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const delayMs = opts?.delayMs ?? 1200;
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    if (opts?.signal?.aborted) throw new Error("已取消");
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/已取消|abort/i.test(msg)) throw e;
      if (i === retries) break;
      opts?.onRetry?.(i + 1, e);
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("已取消"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("已取消"));
      },
      { once: true }
    );
  });
}
