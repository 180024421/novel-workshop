/** 应用内确认 / 输入；由 ConfirmHost 注册 handler */

type ConfirmKind = "confirm" | "prompt";

export type ConfirmRequest = {
  kind: ConfirmKind;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: boolean | string | null) => void;
};

type ConfirmHandler = (req: ConfirmRequest | null) => void;

let handler: ConfirmHandler | null = null;
let current: ConfirmRequest | null = null;
const waiting: ConfirmRequest[] = [];

function showNext() {
  if (!handler) return;
  const next = waiting.shift() || null;
  current = next;
  handler(next);
}

export function registerConfirmHandler(h: ConfirmHandler | null) {
  handler = h;
  if (h) {
    if (current) h(current);
    else if (waiting.length) showNext();
  }
}

function settleCurrent(value: boolean | string | null) {
  const req = current;
  current = null;
  req?.resolve(value);
  showNext();
}

/** 供 ConfirmHost 调用：用户点了确定/取消 */
export function settleConfirm(value: boolean | string | null) {
  settleCurrent(value);
}

function enqueue(req: ConfirmRequest) {
  if (!handler) {
    if (req.kind === "prompt") {
      const v = window.prompt(req.message, req.defaultValue ?? "");
      req.resolve(v);
    } else {
      req.resolve(window.confirm(req.message));
    }
    return;
  }
  waiting.push(req);
  if (!current) showNext();
}

/** 覆盖确认；取消则返回 false */
export function confirmOverwrite(label: string): Promise<boolean> {
  return confirmAction(`将覆盖已有的「${label}」，确定继续？`);
}

/** 通用危险操作确认 */
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({
      kind: "confirm",
      message,
      confirmLabel: "确定",
      cancelLabel: "取消",
      resolve: (v) => resolve(Boolean(v)),
    });
  });
}

/** 应用内文本输入；取消返回 null */
export function promptText(
  label: string,
  defaultValue = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({
      kind: "prompt",
      message: label,
      defaultValue,
      confirmLabel: "确定",
      cancelLabel: "取消",
      resolve: (v) => {
        if (v === null || v === false) resolve(null);
        else resolve(String(v));
      },
    });
  });
}

export function isAbortError(e: unknown): boolean {
  if (!e) return false;
  if (e instanceof DOMException && e.name === "AbortError") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /abort|cancel|已取消|用户取消/i.test(msg);
}
