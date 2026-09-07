/** 改稿任务队列：全书扫禁忌等 */

export type ReviseJobKind = "scan_taboo" | "extract_hooks";

export type ReviseJobItem = {
  chapterId: string;
  chapterTitle: string;
  status: "pending" | "done" | "failed" | "skipped";
  detail?: string;
};

export type ReviseSession = {
  id: string;
  kind: ReviseJobKind;
  items: ReviseJobItem[];
  updatedAt: string;
};

export async function loadReviseSession(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<ReviseSession | null> {
  if (!window.moshu) return null;
  const raw = await window.moshu.readJson<ReviseSession | null>(
    await join(root, "continuity", "revise-session.json"),
    null
  );
  return raw?.id ? raw : null;
}

export async function saveReviseSession(
  root: string,
  join: (...p: string[]) => Promise<string>,
  session: ReviseSession
) {
  if (!window.moshu) return;
  await window.moshu.writeJson(await join(root, "continuity", "revise-session.json"), {
    ...session,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearReviseSession(
  root: string,
  join: (...p: string[]) => Promise<string>
) {
  if (!window.moshu?.deletePath) {
    await saveReviseSession(root, join, {
      id: "",
      kind: "scan_taboo",
      items: [],
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await window.moshu.deletePath(await join(root, "continuity", "revise-session.json"));
}

export function createReviseSession(
  kind: ReviseJobKind,
  chapters: { chapterId: string; chapterTitle: string }[]
): ReviseSession {
  return {
    id: `rev_${Date.now()}`,
    kind,
    items: chapters.map((c) => ({
      chapterId: c.chapterId,
      chapterTitle: c.chapterTitle,
      status: "pending",
    })),
    updatedAt: new Date().toISOString(),
  };
}
