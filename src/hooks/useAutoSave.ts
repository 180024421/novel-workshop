import { useEffect, useRef } from "react";

/**
 * 防抖自动保存。
 * resetKey 变化时（如换章）跳过一次，避免把上一章内容写进新文件名。
 */
export function useAutoSave(
  value: string,
  save: (v: string) => Promise<void>,
  ms = 600,
  resetKey?: string
) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const first = useRef(true);
  const prevKey = useRef(resetKey);

  useEffect(() => {
    if (prevKey.current !== resetKey) {
      prevKey.current = resetKey;
      first.current = true;
    }
    if (first.current) {
      first.current = false;
      return;
    }
    const snapshot = value;
    const t = window.setTimeout(() => {
      void saveRef.current(snapshot);
    }, ms);
    return () => window.clearTimeout(t);
  }, [value, ms, resetKey]);
}
