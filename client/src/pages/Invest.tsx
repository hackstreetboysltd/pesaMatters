import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api, type Investment } from "../api";
import { BackLink } from "../components/BackLink";
import { MarkPlus } from "../components/marks";
import { Nav } from "../components/Nav";
import { formatDayPercent, formatKes } from "../format";

export function Invest(): React.ReactElement {
  const [rows, setRows] = useState<Investment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .investments()
      .then((payload) => {
        if (active) setRows(payload.investments);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not load investments.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <BackLink to="/" label="Back to Pot" />
          <h1 className="screen-title">Invest</h1>
          <Link className="icon-btn" to="/invest/new" aria-label="Add investment">
            <MarkPlus />
          </Link>
        </header>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {rows !== null && rows.length === 0 ? <p className="empty">Nothing held.</p> : null}
        <div className="grid">
          {rows?.map((row) => (
            <Link key={row.id} className="invest-card" to={`/invest/${row.id}`}>
              <h2 className="ticker">{row.symbol}</h2>
              <p className="holding-name">{row.name}</p>
              <p className="money">{formatKes(row.valueCents)}</p>
              {row.dayChangeBps !== null ? (
                <p className={row.dayChangeBps >= 0 ? "gain-up" : "gain-down"}>
                  {formatDayPercent(row.dayChangeBps)}
                </p>
              ) : (
                <p className="meta">Close pending</p>
              )}
            </Link>
          ))}
        </div>
      </main>
      <Nav />
    </>
  );
}
