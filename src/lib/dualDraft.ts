/** 双稿 A/B：主稿 chapters；B 稿 drafts/ */

export type DraftSlot = "A" | "B";

export function draftBPathParts(chapterId: string) {
  return ["drafts", `${chapterId}-B.md`] as const;
}

export async function loadDraftB(
  root: string,
  join: (...p: string[]) => Promise<string>,
  chapterId: string
): Promise<string> {
  if (!window.moshu) return "";
  const [dir, file] = draftBPathParts(chapterId);
  try {
    return await window.moshu.readText(await join(root, dir, file));
  } catch {
    return "";
  }
}

export async function saveDraftB(
  root: string,
  join: (...p: string[]) => Promise<string>,
  chapterId: string,
  body: string
) {
  if (!window.moshu) return;
  const [dir, file] = draftBPathParts(chapterId);
  await window.moshu.writeText(await join(root, dir, file), body);
}

export async function clearDraftB(
  root: string,
  join: (...p: string[]) => Promise<string>,
  chapterId: string
) {
  if (!window.moshu?.deletePath) return;
  const [dir, file] = draftBPathParts(chapterId);
  await window.moshu.deletePath(await join(root, dir, file));
}
