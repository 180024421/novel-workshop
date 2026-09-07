export type BatchSession = {
  id: string;
  from: number;
  to: number;
  preset: "quality" | "fast";
  skipExisting: boolean;
  targetWords: number;
  delayMs: number;
  done: string[];
  failed: { chapterId: string; error: string }[];
  pending: string[];
  updatedAt: string;
};

const SESSION_FILE = "batch-session.json";

function emptySession(): null {
  return null;
}

export async function loadBatchSession(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<BatchSession | null> {
  if (!window.moshu) return emptySession();
  try {
    const data = await window.moshu.readJson<BatchSession | null>(
      await join(root, "continuity", SESSION_FILE),
      null
    );
    if (!data || typeof data !== "object" || !Array.isArray(data.pending)) return null;
    return {
      id: String(data.id || ""),
      from: Number(data.from) || 1,
      to: Number(data.to) || 1,
      preset: data.preset === "fast" ? "fast" : "quality",
      skipExisting: data.skipExisting !== false,
      targetWords: Math.max(800, Number(data.targetWords) || 2500),
      delayMs: Math.max(0, Number(data.delayMs) || 0),
      done: Array.isArray(data.done) ? data.done.map(String) : [],
      failed: Array.isArray(data.failed)
        ? data.failed.map((f) => ({
            chapterId: String(f?.chapterId || ""),
            error: String(f?.error || ""),
          }))
        : [],
      pending: data.pending.map(String),
      updatedAt: String(data.updatedAt || ""),
    };
  } catch {
    return null;
  }
}

export async function saveBatchSession(
  root: string,
  join: (...p: string[]) => Promise<string>,
  session: BatchSession
): Promise<void> {
  if (!window.moshu) return;
  await window.moshu.writeJson(await join(root, "continuity", SESSION_FILE), {
    ...session,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearBatchSession(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<void> {
  if (!window.moshu) return;
  try {
    await window.moshu.deletePath(await join(root, "continuity", SESSION_FILE));
  } catch {
    await window.moshu.writeJson(await join(root, "continuity", SESSION_FILE), null);
  }
}

export function createBatchSession(opts: {
  from: number;
  to: number;
  preset: "quality" | "fast";
  skipExisting: boolean;
  targetWords: number;
  delayMs: number;
  chapterIds: string[];
}): BatchSession {
  return {
    id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    from: opts.from,
    to: opts.to,
    preset: opts.preset,
    skipExisting: opts.skipExisting,
    targetWords: opts.targetWords,
    delayMs: opts.delayMs,
    done: [],
    failed: [],
    pending: [...opts.chapterIds],
    updatedAt: new Date().toISOString(),
  };
}

export function markBatchDone(session: BatchSession, chapterId: string): BatchSession {
  return {
    ...session,
    done: session.done.includes(chapterId) ? session.done : [...session.done, chapterId],
    pending: session.pending.filter((id) => id !== chapterId),
    failed: session.failed.filter((f) => f.chapterId !== chapterId),
    updatedAt: new Date().toISOString(),
  };
}

export function markBatchFailed(
  session: BatchSession,
  chapterId: string,
  error: string
): BatchSession {
  const failed = session.failed.filter((f) => f.chapterId !== chapterId);
  failed.push({ chapterId, error });
  return {
    ...session,
    failed,
    pending: session.pending.filter((id) => id !== chapterId),
    updatedAt: new Date().toISOString(),
  };
}

export function markBatchSkipped(session: BatchSession, chapterId: string): BatchSession {
  return markBatchDone(session, chapterId);
}

export function sessionProgressLabel(session: BatchSession): string {
  const total = session.done.length + session.failed.length + session.pending.length;
  return `${session.done.length}/${total} 完成 · 失败 ${session.failed.length} · 待写 ${session.pending.length}`;
}
