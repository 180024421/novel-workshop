import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

export type StudioCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  spellCheck?: boolean;
  /** Textarea-compatible shim for ChapterTools / find-replace */
  editorRef?: React.RefObject<HTMLTextAreaElement | null>;
  onSelectionChange?: () => void;
};

function buildTextareaShim(view: EditorView): HTMLTextAreaElement {
  const shim = {
    get selectionStart() {
      return view.state.selection.main.from;
    },
    get selectionEnd() {
      return view.state.selection.main.to;
    },
    setSelectionRange(from: number, to: number) {
      const len = view.state.doc.length;
      const a = Math.max(0, Math.min(from, len));
      const b = Math.max(0, Math.min(to, len));
      view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
    },
    focus() {
      view.focus();
    },
    get scrollTop() {
      return view.scrollDOM.scrollTop;
    },
    set scrollTop(v: number) {
      view.scrollDOM.scrollTop = v;
    },
    get value() {
      return view.state.doc.toString();
    },
  };
  return shim as unknown as HTMLTextAreaElement;
}

/** CodeMirror 6 正文编辑器；对外尽量对齐 textarea 能力 */
export function StudioCodeEditor({
  value,
  onChange,
  className,
  style,
  placeholder,
  editorRef,
  onSelectionChange,
}: StudioCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelRef = useRef(onSelectionChange);
  onSelRef.current = onSelectionChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!hostRef.current) return;
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        onSelRef.current?.();
      }
    });
    const extensions = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      markdown(),
      EditorView.lineWrapping,
      updateListener,
      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: "inherit",
          lineHeight: "inherit",
          backgroundColor: "transparent",
          color: "inherit",
        },
        ".cm-content": {
          fontFamily: "inherit",
          caretColor: "inherit",
          padding: "8px 12px",
          minHeight: "100%",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
          color: "var(--muted, #888)",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "inherit",
        },
        "&.cm-focused": { outline: "none" },
      }),
    ];
    if (placeholder) {
      extensions.push(cmPlaceholder(placeholder));
    }
    const state = EditorState.create({
      doc: valueRef.current,
      extensions,
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    if (editorRef) {
      (editorRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
        buildTextareaShim(view);
    }
    return () => {
      if (editorRef) {
        (editorRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = null;
      }
      view.destroy();
      viewRef.current = null;
    };
    // mount once; value sync below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === value) return;
    view.dispatch({
      changes: { from: 0, to: cur.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !editorRef) return;
    (editorRef as React.MutableRefObject<HTMLTextAreaElement | null>).current =
      buildTextareaShim(view);
  });

  return (
    <div
      ref={hostRef}
      className={className ? `${className} studio-cm` : "studio-cm"}
      style={style}
      data-testid="studio-code-editor"
    />
  );
}
