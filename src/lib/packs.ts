/** 本地扩展包（非云商店） */

export type PackManifest = {
  id: string;
  name: string;
  description: string;
  version?: string;
  files?: {
    style?: string;
    taboo?: string;
    outlineHint?: string;
    exportNote?: string;
  };
};

export type PackInfo = PackManifest & {
  dir: string;
  builtin: boolean;
};

const BUILTIN_FALLBACK: PackInfo[] = [
  {
    id: "craft-core",
    name: "写作工艺红线包",
    description: "禁止啰嗦/重复/电报文/顶真/标语口号；强制画面感与张力",
    version: "1.0",
    dir: "craft-core",
    builtin: true,
    files: { style: "style.md", taboo: "taboo.md" },
  },
  {
    id: "kuang-taboo",
    name: "爽文禁忌词包",
    description: "覆盖常见网文套话禁忌列表",
    version: "1.0",
    dir: "kuang-taboo",
    builtin: true,
    files: { taboo: "taboo.md" },
  },
  {
    id: "qidian-export",
    name: "起点导出提示",
    description: "写入导出说明到 prompts/export-qidian.md",
    version: "1.0",
    dir: "qidian-export",
    builtin: true,
    files: { exportNote: "export-note.md" },
  },
  {
    id: "suspense-pace",
    name: "悬疑节奏包",
    description: "风格 + 总纲提示偏悬疑",
    version: "1.0",
    dir: "suspense-pace",
    builtin: true,
    files: { style: "style.md", outlineHint: "outline-hint.md", taboo: "taboo.md" },
  },
];

async function readPackFromDir(
  dir: string,
  builtin: boolean
): Promise<PackInfo | null> {
  if (!window.moshu) return null;
  const manifestPath = await window.moshu.joinPath(dir, "pack.json");
  const raw = await window.moshu.readText(manifestPath);
  if (!raw.trim()) return null;
  try {
    const m = JSON.parse(raw) as PackManifest;
    if (!m.id || !m.name) return null;
    return { ...m, dir, builtin };
  } catch {
    return null;
  }
}

export async function listBuiltinPacks(): Promise<PackInfo[]> {
  const out: PackInfo[] = [];
  if (window.moshu?.listPacks) {
    try {
      const dirs = await window.moshu.listPacks();
      for (const dir of dirs) {
        const p = await readPackFromDir(dir, true);
        if (p) out.push(p);
      }
    } catch {
      /* fallthrough */
    }
  }
  if (!out.length) return BUILTIN_FALLBACK;
  return out;
}

/** 内置 + 用户导入（userData/packs） */
export async function listAllPacks(): Promise<PackInfo[]> {
  const builtin = await listBuiltinPacks();
  const user: PackInfo[] = [];
  if (window.moshu?.listUserPacks) {
    try {
      const dirs = await window.moshu.listUserPacks();
      for (const dir of dirs) {
        const p = await readPackFromDir(dir, false);
        if (p) user.push(p);
      }
    } catch {
      /* ignore */
    }
  }
  // 用户包覆盖同 id 内置展示顺序：用户在前
  const byId = new Map<string, PackInfo>();
  for (const p of builtin) byId.set(p.id, p);
  for (const p of user) byId.set(p.id, p);
  return [...byId.values()];
}

export async function applyPackToProject(
  pack: PackInfo,
  root: string,
  join: (...p: string[]) => Promise<string>
) {
  if (!window.moshu) throw new Error("需要桌面端");
  const files = pack.files || {};
  const read = async (rel?: string) => {
    if (!rel) return "";
    // builtin fallback content if no real dir
    if (pack.dir.includes("/") || pack.dir.includes("\\")) {
      return window.moshu!.readText(await window.moshu!.joinPath(pack.dir, rel));
    }
    // try resources path via listPacks dirs
    if (window.moshu?.listPacks) {
      const dirs = await window.moshu.listPacks();
      const hit = dirs.find((d) => d.replace(/\\/g, "/").endsWith(pack.dir) || d.includes(pack.id));
      if (hit) return window.moshu.readText(await window.moshu.joinPath(hit, rel));
    }
    return "";
  };

  if (files.style) {
    const t = (await read(files.style)) || (await builtinFile(pack.id, files.style));
    if (t) await window.moshu.writeText(await join(root, "prompts", "style.md"), t);
  }
  if (files.taboo) {
    const t = (await read(files.taboo)) || (await builtinFile(pack.id, files.taboo));
    if (t) await window.moshu.writeText(await join(root, "prompts", "taboo.md"), t);
  }
  if (files.outlineHint) {
    const t = (await read(files.outlineHint)) || (await builtinFile(pack.id, files.outlineHint));
    if (t) await window.moshu.writeText(await join(root, "prompts", "outline-hint.md"), t);
  }
  if (files.exportNote) {
    const t = (await read(files.exportNote)) || (await builtinFile(pack.id, files.exportNote));
    if (t) await window.moshu.writeText(await join(root, "prompts", "export-qidian.md"), t);
  }
}

async function builtinFile(packId: string, file: string): Promise<string> {
  // content embedded for when packs aren't on disk yet in web mode
  const map: Record<string, Record<string, string>> = {
    "craft-core": {
      "style.md":
        "# 写作工艺\n\n禁止啰嗦重复电报文顶真标语口号讲课总结腔。\n必须：人物丰满、画面、张力、合理典故修辞、信息增量、对白有用。\n",
      "taboo.md":
        "- 这一刀，注定\n- 改写命运\n- 邪不胜正\n- 我们一定能赢\n- 他明白了\n- 从今往后\n- 无比强大\n- 更大的风暴\n",
    },
    "kuang-taboo": {
      "taboo.md":
        "- 总之\n- 总而言之\n- 不禁\n- 目光如炬\n- 嘴角微微上扬\n- 杀气腾腾\n- 心中暗道\n- 缓缓道\n- 宛如\n- 这一刀，注定\n- 改写命运\n- 更大的风暴\n",
    },
    "qidian-export": {
      "export-note.md":
        "# 起点导出说明\n\n- 章名单独一行\n- 正文勿带 Markdown 标题符号过多\n- 每章建议 2000～4000 字\n",
    },
    "suspense-pace": {
      "style.md":
        "- 线索埋设与回收要干净\n- 信息差制造张力\n- 气氛靠细节，少空洞形容词\n",
      "outline-hint.md": "每章至少推进一条线索或反转，章末留疑问。\n",
      "taboo.md": "- 突然揭晓无铺垫\n- 无意义误导\n",
    },
  };
  return map[packId]?.[file] || "";
}

export async function importPackFolder(
  folder: string
): Promise<PackInfo | null> {
  return readPackFromDir(folder, false);
}
