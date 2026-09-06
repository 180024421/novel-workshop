export type AgentMsg = { role: "user" | "assistant"; content: string };

export type StudioMode = "idea" | "outline" | "beats" | "chapter";

type ChatStore = {
  version: 1;
  threads: Record<string, AgentMsg[]>;
};

const MAX_MSGS = 60;

function threadId(mode: StudioMode, scope: string) {
  return `${mode}:${scope}`;
}

function legacyLocalKey(root: string, mode: StudioMode, scope: string) {
  return `moshu-agent:${root}:${mode}:${scope}`;
}

function loadLegacyLocal(root: string, mode: StudioMode, scope: string): AgentMsg[] {
  try {
    const raw = localStorage.getItem(legacyLocalKey(root, mode, scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentMsg[];
    return Array.isArray(parsed) ? parsed.filter((m) => m?.role && typeof m.content === "string") : [];
  } catch {
    return [];
  }
}

async function readStore(
  root: string,
  join: (...p: string[]) => Promise<string>
): Promise<ChatStore> {
  if (!window.moshu) return { version: 1, threads: {} };
  const path = await join(root, "meta", "agent-chats.json");
  const data = await window.moshu.readJson<ChatStore>(path, { version: 1, threads: {} });
  if (!data || typeof data !== "object") return { version: 1, threads: {} };
  return {
    version: 1,
    threads: data.threads && typeof data.threads === "object" ? data.threads : {},
  };
}

async function writeStore(
  root: string,
  join: (...p: string[]) => Promise<string>,
  store: ChatStore
) {
  if (!window.moshu) return;
  const path = await join(root, "meta", "agent-chats.json");
  await window.moshu.writeJson(path, store);
}

/** 读取某模式的会话；优先书稿内文件，兼容旧 localStorage */
export async function loadAgentThread(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  mode: StudioMode;
  scope: string;
}): Promise<AgentMsg[]> {
  const id = threadId(opts.mode, opts.scope);
  try {
    const store = await readStore(opts.root, opts.join);
    const fromDisk = store.threads[id];
    if (Array.isArray(fromDisk) && fromDisk.length) {
      return fromDisk.filter((m) => m?.role && typeof m.content === "string");
    }
  } catch {
    /* ignore */
  }

  const legacy = loadLegacyLocal(opts.root, opts.mode, opts.scope);
  if (legacy.length) {
    // 迁移到书稿目录
    try {
      await saveAgentThread({ ...opts, messages: legacy });
      localStorage.removeItem(legacyLocalKey(opts.root, opts.mode, opts.scope));
    } catch {
      /* ignore */
    }
  }
  return legacy;
}

/** 写入会话到书稿 meta/agent-chats.json，并镜像一份 localStorage 作备份 */
export async function saveAgentThread(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  mode: StudioMode;
  scope: string;
  messages: AgentMsg[];
}) {
  const id = threadId(opts.mode, opts.scope);
  const trimmed = opts.messages.slice(-MAX_MSGS).filter((m) => m?.role && typeof m.content === "string");

  try {
    localStorage.setItem(
      legacyLocalKey(opts.root, opts.mode, opts.scope),
      JSON.stringify(trimmed)
    );
  } catch {
    /* ignore */
  }

  if (!window.moshu) return;

  const store = await readStore(opts.root, opts.join);
  if (!trimmed.length) {
    delete store.threads[id];
  } else {
    store.threads[id] = trimmed;
  }
  await writeStore(opts.root, opts.join, store);
}

export async function clearAgentThread(opts: {
  root: string;
  join: (...p: string[]) => Promise<string>;
  mode: StudioMode;
  scope: string;
}) {
  await saveAgentThread({ ...opts, messages: [] });
  try {
    localStorage.removeItem(legacyLocalKey(opts.root, opts.mode, opts.scope));
  } catch {
    /* ignore */
  }
}

export function chatScope(mode: StudioMode, volumeId: string, chapterId: string) {
  if (mode === "beats") return volumeId;
  if (mode === "chapter") return chapterId;
  return mode;
}
