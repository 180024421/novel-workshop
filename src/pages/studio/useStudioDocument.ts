import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoSave } from "../../hooks/useAutoSave";
import { syncChapterFileName } from "../../lib/chapterFiles";
import { indexChapterToKb } from "../../lib/kb";
import {
  chatScope,
  loadAgentThread,
  saveAgentThread,
  type AgentMsg,
  type StudioMode,
} from "../../lib/agentChatStore";
import {
  ensureVolumeBeatsFile,
  findVolumeForChapter,
  loadChapterBeatsText,
  loadProjectVolumes,
  volumeBeatsPath,
  type VolumeEntry,
} from "../../lib/volumes";
import type { AppSettings, OpenedProject } from "../../types";
import { EMPTY_VOLUMES } from "./studioShared";

type Args = {
  mode: StudioMode;
  project: OpenedProject | null;
  join: (...parts: string[]) => Promise<string>;
  settings: AppSettings;
  chapterId: string;
  setChapterId: (id: string) => void;
  chapterTitle: string;
  setChapterTitle: (t: string) => void;
  volumeId: string;
  setVolumeId: (id: string) => void;
};

/** 文档加载 / 自动保存 / 手动保存 / 卷与细纲上下文 */
export function useStudioDocument({
  mode,
  project,
  join,
  settings,
  chapterId,
  setChapterTitle,
  chapterTitle,
  volumeId,
  setVolumeId,
}: Args) {
  const [doc, setDoc] = useState("");
  const [seed, setSeed] = useState("");
  const [outline, setOutline] = useState("");
  const [bible, setBible] = useState("");
  const [style, setStyle] = useState("");
  const [volumes, setVolumes] = useState<VolumeEntry[]>(EMPTY_VOLUMES);
  const [chapterBeats, setChapterBeats] = useState("");
  const [hint, setHint] = useState("");
  const [err, setErr] = useState("");
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [messages, setMessages] = useState<AgentMsg[]>([]);
  const skipSaveRef = useRef(true);
  const chatHydratedRef = useRef(false);
  const chatScopeRef = useRef("");

  const refreshVolumes = useCallback(
    async (outlineOverride?: string) => {
      if (!project || !window.moshu) return EMPTY_VOLUMES;
      const vols = await loadProjectVolumes({
        root: project.root,
        join,
        outline: outlineOverride ?? outline,
      });
      setVolumes(vols.length ? vols : EMPTY_VOLUMES);
      return vols.length ? vols : EMPTY_VOLUMES;
    },
    [project, join, outline]
  );

  const scopeKey = chatScope(mode, volumeId, chapterId);
  chatScopeRef.current = scopeKey;

  const fileHint = useMemo(() => {
    if (mode === "idea") return "bible/world.md";
    if (mode === "outline") return "outlines/outline.md";
    if (mode === "beats") return `beats/${volumeBeatsPath(volumeId)}`;
    return `chapters/${chapterId}_….md`;
  }, [mode, volumeId, chapterId]);

  useEffect(() => {
    if (!project || !window.moshu) return;
    let cancelled = false;
    (async () => {
      setLoadingDoc(true);
      setErr("");
      skipSaveRef.current = true;
      chatHydratedRef.current = false;
      const w = window.moshu!;
      try {
        const [seedT, bibleT, styleT, outlineT] = await Promise.all([
          w.readText(await join(project.root, "ideas", "seed.md")),
          w.readText(await join(project.root, "bible", "world.md")),
          w.readText(await join(project.root, "prompts", "style.md")),
          w.readText(await join(project.root, "outlines", "outline.md")),
        ]);
        if (cancelled) return;
        setSeed(seedT);
        setBible(bibleT);
        setStyle(styleT);
        setOutline(outlineT);

        const vols = await loadProjectVolumes({
          root: project.root,
          join,
          outline: outlineT,
        });
        setVolumes(vols.length ? vols : EMPTY_VOLUMES);
        let vid = vols[0]?.id || "第1卷";
        const hit = findVolumeForChapter(vols, chapterId);
        if (hit) vid = hit.id;
        if (mode === "chapter") setVolumeId(vid);

        let text = "";
        if (mode === "idea") {
          text = bibleT.trim() ? bibleT : seedT;
        } else if (mode === "outline") {
          text = outlineT;
        } else if (mode === "beats") {
          if (volumeId && /^第\d+卷$/.test(volumeId)) vid = volumeId;
          setVolumeId(vid);
          const ensured = await ensureVolumeBeatsFile({
            root: project.root,
            join,
            volumeId: vid,
          });
          text = ensured.text;
          if (ensured.created) {
            const vol = vols.find((v) => v.id === vid) || vols[0];
            const parts: string[] = [];
            if (vol) {
              for (const c of vol.chapters) {
                const legacy = await w.readText(
                  await join(project.root, "beats", `${c.id}.md`)
                );
                if (legacy.trim()) {
                  parts.push(
                    legacy.trim().startsWith("#")
                      ? legacy.trim()
                      : `## ${c.id} ${c.title}\n\n${legacy.trim()}`
                  );
                }
              }
            }
            if (parts.length) {
              text = `${ensured.text.trim()}\n\n${parts.join("\n\n")}`;
              await w.writeText(
                await join(project.root, "beats", volumeBeatsPath(vid)),
                text
              );
            }
          } else if (!text.trim()) {
            text = ensured.text;
          }
        } else {
          const files = await w.listDir(await join(project.root, "chapters"));
          const chFile = files.find(
            (f) => f.name === `${chapterId}.md` || f.name.startsWith(`${chapterId}_`)
          );
          text = chFile ? await w.readText(chFile.path) : "";
          const ch = vols.flatMap((v) => v.chapters).find((c) => c.id === chapterId);
          if (ch?.title) setChapterTitle(ch.title);
          const hitVol = findVolumeForChapter(vols, chapterId);
          if (hitVol) setVolumeId(hitVol.id);
          const beatsLoaded = await loadChapterBeatsText({
            root: project.root,
            join,
            chapterId,
            volumeId: hitVol?.id,
            outline: outlineT,
          });
          setChapterBeats(beatsLoaded.text);
        }
        if (cancelled) return;
        setDoc(text);
        chatHydratedRef.current = false;
        const thread = await loadAgentThread({
          root: project.root,
          join,
          mode,
          scope: chatScope(mode, vid, chapterId),
        });
        if (cancelled) return;
        setMessages(thread);
        chatHydratedRef.current = true;
        setHint(thread.length ? `已恢复 ${thread.length} 条对话` : "");
      } finally {
        if (!cancelled) {
          setLoadingDoc(false);
          window.setTimeout(() => {
            skipSaveRef.current = false;
          }, 50);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.root, mode, chapterId, volumeId]);

  useEffect(() => {
    if (!project || !chatHydratedRef.current || loadingDoc) return;
    const msgs = messages;
    const modeSnap = mode;
    const scopeSnap = scopeKey;
    const t = window.setTimeout(() => {
      void saveAgentThread({
        root: project.root,
        join,
        mode: modeSnap,
        scope: scopeSnap,
        messages: msgs,
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [messages, project, mode, scopeKey, loadingDoc, join]);

  useAutoSave(
    doc,
    async (v) => {
      if (!project || !window.moshu || loadingDoc || skipSaveRef.current) return;
      if (mode === "idea") {
        await window.moshu.writeText(await join(project.root, "bible", "world.md"), v);
        setBible(v);
        setHint("设定已自动保存");
      } else if (mode === "outline") {
        await window.moshu.writeText(await join(project.root, "outlines", "outline.md"), v);
        setOutline(v);
        setHint("总纲已自动保存");
      } else if (mode === "beats") {
        await window.moshu.writeText(
          await join(project.root, "beats", volumeBeatsPath(volumeId)),
          v
        );
        void refreshVolumes();
        setHint("本卷细纲已自动保存");
      } else {
        await syncChapterFileName({
          root: project.root,
          join,
          chapterId,
          title: chapterTitle,
          body: v,
        });
        if (settings.kbAutoIndexChapters !== false) {
          try {
            await indexChapterToKb(project.root, join, chapterId, v);
          } catch {
            /* ignore */
          }
        }
        setHint("正文已自动保存");
      }
    },
    700,
    `${mode}:${scopeKey}`
  );

  const saveNow = useCallback(async () => {
    if (!project || !window.moshu || loadingDoc) return;
    const v = doc;
    if (mode === "idea") {
      await window.moshu.writeText(await join(project.root, "bible", "world.md"), v);
      setBible(v);
      setHint("设定已保存");
    } else if (mode === "outline") {
      await window.moshu.writeText(await join(project.root, "outlines", "outline.md"), v);
      setOutline(v);
      setHint("总纲已保存");
    } else if (mode === "beats") {
      await window.moshu.writeText(
        await join(project.root, "beats", volumeBeatsPath(volumeId)),
        v
      );
      void refreshVolumes();
      setHint("本卷细纲已保存");
    } else {
      await syncChapterFileName({
        root: project.root,
        join,
        chapterId,
        title: chapterTitle,
        body: v,
      });
      if (settings.kbAutoIndexChapters !== false) {
        try {
          await indexChapterToKb(project.root, join, chapterId, v);
        } catch {
          /* ignore */
        }
      }
      setHint("正文已保存");
    }
  }, [
    project,
    loadingDoc,
    doc,
    mode,
    join,
    volumeId,
    chapterId,
    chapterTitle,
    refreshVolumes,
    settings.kbAutoIndexChapters,
  ]);

  return {
    doc,
    setDoc,
    seed,
    outline,
    setOutline,
    bible,
    style,
    volumes,
    setVolumes,
    chapterBeats,
    hint,
    setHint,
    err,
    setErr,
    loadingDoc,
    messages,
    setMessages,
    fileHint,
    scopeKey,
    refreshVolumes,
    saveNow,
  };
}
