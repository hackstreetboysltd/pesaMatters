import type { ActivityLine } from "../api";
import { formatWhen } from "../format";

export function Slips({ lines, empty }: { lines: ActivityLine[]; empty: string }): React.ReactElement {
  if (lines.length === 0) {
    return <p className="hint">{empty}</p>;
  }
  return (
    <ul className="list">
      {lines.map((line) => (
        <li key={line.id} className="slip">
          <p className="slip-time">{formatWhen(line.at)}</p>
          <p className="slip-text">{line.text}</p>
        </li>
      ))}
    </ul>
  );
}
