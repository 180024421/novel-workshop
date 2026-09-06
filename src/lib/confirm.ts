/** 覆盖确认；取消则返回 false */
export function confirmOverwrite(label: string): boolean {
  return window.confirm(`将覆盖已有的「${label}」，确定继续？`);
}

/** 通用危险操作确认 */
export function confirmAction(message: string): boolean {
  return window.confirm(message);
}

export function isAbortError(e: unknown): boolean {
  if (!e) return false;
  if (e instanceof DOMException && e.name === "AbortError") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /abort|cancel|已取消|用户取消/i.test(msg);
}
