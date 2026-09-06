/** 上次写作会话（续写） */

export type WritingSession = {
  root: string;
  title: string;
  chapterId: string;
  chapterTitle: string;
  volumeId?: string;
  route: string;
  updatedAt: number;
};

const BY_ROOT_KEY = "moshu.sessionsByRoot";

function readByRootMap(): Record<string, WritingSession> {
  try {
    const raw = localStorage.getItem(BY_ROOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WritingSession>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeByRootMap(map: Record<string, WritingSession>) {
  try {
    localStorage.setItem(BY_ROOT_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function rememberRoot(s: WritingSession) {
  const map = readByRootMap();
  map[s.root] = s;
  writeByRootMap(map);
}

export async function loadSession(): Promise<WritingSession | null> {
  if (window.moshu?.getSession) {
    return window.moshu.getSession();
  }
  try {
    const raw = localStorage.getItem("moshu.session");
    if (raw) return JSON.parse(raw) as WritingSession;
  } catch {
    /* ignore */
  }
  return null;
}

/** 按书稿路径取上次阅读/写作位置（切书用） */
export async function loadSessionForRoot(root: string): Promise<WritingSession | null> {
  if (!root) return null;
  const map = readByRootMap();
  if (map[root]?.root === root) return map[root];
  const cur = await loadSession();
  if (cur?.root === root) return cur;
  return null;
}

export async function saveSession(s: WritingSession | null): Promise<void> {
  if (s?.root) rememberRoot(s);
  if (window.moshu?.setSession) {
    await window.moshu.setSession(s);
    return;
  }
  if (!s) localStorage.removeItem("moshu.session");
  else localStorage.setItem("moshu.session", JSON.stringify(s));
}

/** 从最近列表移除（不删磁盘书稿） */
export function forgetSessionRoot(root: string): void {
  const map = readByRootMap();
  if (map[root]) {
    delete map[root];
    writeByRootMap(map);
  }
}
