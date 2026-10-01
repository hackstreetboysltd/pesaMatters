import { Link } from "react-router-dom";

type BackLinkProps = {
  to: string;
  label: string;
};

export function BackLink({ to, label }: BackLinkProps): React.ReactElement {
  return (
    <Link className="back-link" to={to} aria-label={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" />
        <path d="M12 5l-7 7 7 7" />
      </svg>
    </Link>
  );
}
