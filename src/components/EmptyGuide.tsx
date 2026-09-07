import { Link } from "react-router-dom";

export type EmptyGuideStep = string | { text: string; to?: string };

export function EmptyGuide(props: {
  title: string;
  steps: EmptyGuideStep[];
  primaryTo?: string;
  primaryLabel?: string;
  secondaryTo?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="empty-guide">
      <div className="empty-guide-title">{props.title}</div>
      <ol className="empty-guide-steps">
        {props.steps.map((s, i) => {
          const text = typeof s === "string" ? s : s.text;
          const to = typeof s === "string" ? undefined : s.to;
          return (
            <li key={`${i}-${text}`}>
              {to ? <Link to={to}>{text}</Link> : text}
            </li>
          );
        })}
      </ol>
      <div className="row">
        {props.primaryTo && (
          <Link className="btn btn-primary" to={props.primaryTo}>
            {props.primaryLabel || "下一步"}
          </Link>
        )}
        {props.secondaryTo && (
          <Link className="btn btn-ghost" to={props.secondaryTo}>
            {props.secondaryLabel || "了解更多"}
          </Link>
        )}
      </div>
    </div>
  );
}

/** 开书缺件 checklist：工艺 → 设定 → 总纲 → 细纲 → 第1章 */
export function buildProjectChecklist(opts: {
  hasCraft?: boolean;
  hasBible: boolean;
  hasOutline: boolean;
  hasBeats: boolean;
  hasChapter1: boolean;
}): { text: string; to: string; done: boolean }[] {
  return [
    {
      text: "应用工艺包 / 补工艺红线",
      to: "/app/packs",
      done: Boolean(opts.hasCraft),
    },
    { text: "写设定 / 世界观", to: "/app/idea", done: opts.hasBible },
    { text: "生成总纲", to: "/app/outline", done: opts.hasOutline },
    { text: "补细纲场次", to: "/app/beats", done: opts.hasBeats },
    { text: "写第1章正文", to: "/app/chapter", done: opts.hasChapter1 },
  ];
}
