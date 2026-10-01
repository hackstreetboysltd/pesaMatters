import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, api, type InvestmentDetail } from "../api";
import { BackLink } from "../components/BackLink";
import { Nav } from "../components/Nav";
import { formatDayPercent, formatKes, formatNairobiDay, formatSession, formatUnits, formatWhen } from "../format";

export function InvestDetail(): React.ReactElement {
  const { id } = useParams();
  const [row, setRow] = useState<InvestmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    let active = true;
    api
      .investment(id)
      .then((payload) => {
        if (active) setRow(payload.investment);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not open this investment.");
      });
    return () => {
      active = false;
    };
  }, [id]);

  const boughtAt = row === null ? "" : formatNairobiDay(row.openedAt);
  const buyPrice = row?.marks[0]?.priceCents ?? row?.priceCents ?? 0;
  const today = formatNairobiDay(new Date().toISOString());

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <BackLink to="/invest" label="Back to Investments" />
          <h1 className="screen-title">{row?.name ?? "Investment"}</h1>
        </header>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {row !== null ? (
          <>
            <p className="ticker">{row.symbol}</p>
            <p className="money">{formatKes(row.valueCents)}</p>
            {row.dayChangeBps !== null ? (
              <p className={row.dayChangeBps >= 0 ? "gain-up" : "gain-down"}>{formatDayPercent(row.dayChangeBps)}</p>
            ) : (
              <p className="meta">Close pending</p>
            )}
            <p className="meta">
              Bought {boughtAt}: {formatUnits(row.units)} shares for {formatKes(row.costCents)} when the close was{" "}
              {formatKes(buyPrice)}.
            </p>
            <p className="meta">
              Today is {today}.
              {row.priorCloseCents !== null && row.priorSession !== null
                ? ` The close on ${formatSession(row.priorSession)} was ${formatKes(row.priorCloseCents)}.`
                : " The previous close is not in yet."}
              {row.closeSession !== null ? ` The latest close is ${formatSession(row.closeSession)}.` : ""}
            </p>
            <p className="meta">
              Since the buy: {row.gainCents >= 0 ? "+" : "−"} {formatKes(Math.abs(row.gainCents))}. Closes refresh at 00:01
              Nairobi time.
            </p>
            <PriceChart marks={row.marks} cost={row.marks[0]?.priceCents ?? row.priceCents} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {row.marks.map((mark) => (
                    <tr key={mark.at}>
                      <td>{formatWhen(mark.at)}</td>
                      <td>{formatKes(mark.priceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </main>
      <Nav />
    </>
  );
}

function PriceChart({ marks, cost }: { marks: { at: string; priceCents: number }[]; cost: number }): React.ReactElement {
  const width = 320;
  const height = 160;
  const pad = 16;
  const prices = marks.map((mark) => mark.priceCents);
  const min = Math.min(cost, ...prices);
  const max = Math.max(cost, ...prices);
  const span = Math.max(1, max - min);
  const coords = marks.map((mark, index) => {
    const x = pad + (index / Math.max(1, marks.length - 1)) * (width - pad * 2);
    const y = height - pad - ((mark.priceCents - min) / span) * (height - pad * 2);
    return { x, y };
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const area =
    first !== undefined && last !== undefined
      ? `${line} L${last.x.toFixed(1)} ${height - pad} L${first.x.toFixed(1)} ${height - pad} Z`
      : "";
  const costY = height - pad - ((cost - min) / span) * (height - pad * 2);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price from the buy to the latest mark">
      <line x1={pad} x2={width - pad} y1={costY} y2={costY} stroke="var(--muted)" strokeDasharray="4 4" />
      {area.length > 0 ? <path d={area} fill="color-mix(in srgb, var(--ember) 28%, transparent)" /> : null}
      {line.length > 0 ? <path d={line} fill="none" stroke="var(--ember)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /> : null}
    </svg>
  );
}
