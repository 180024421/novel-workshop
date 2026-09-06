import { Link } from "react-router-dom";

export function EmptyGuide(props: {
  title: string;
  steps: string[];
  primaryTo?: string;
  primaryLabel?: string;
  secondaryTo?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="empty-guide">
      <div className="empty-guide-title">{props.title}</div>
      <ol className="empty-guide-steps">
        {props.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
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
