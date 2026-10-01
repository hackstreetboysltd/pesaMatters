import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api, type CloseQuote, type ListedShare } from "../api";
import { BackLink } from "../components/BackLink";
import { Nav } from "../components/Nav";
import { Dropdown } from "../components/Dropdown";
import { formatDayPercent, formatKes, formatSession, formatUnits, formatUsd } from "../format";

export function InvestNew(): React.ReactElement {
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [units, setUnits] = useState("");
  const [quote, setQuote] = useState<CloseQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shares, setShares] = useState<ListedShare[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .symbols()
      .then((payload) => {
        if (active) setShares(payload.symbols);
      })
      .catch((caught: unknown) => {
        if (active) setListError(caught instanceof ApiError ? caught.message : "Could not load the NSE list.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const ticker = symbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker)) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api
        .quote(ticker)
        .then((payload) => {
          if (!active) return;
          setQuote(payload);
          setQuoteError(null);
          if (!nameTouched) setName(payload.name);
        })
        .catch((caught: unknown) => {
          if (!active) return;
          setQuote(null);
          setQuoteError(caught instanceof ApiError ? caught.message : "Could not look up that close.");
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [symbol, nameTouched]);

  const unitCount = Number(units);
  const costCents =
    quote !== null && Number.isFinite(unitCount) && unitCount > 0
      ? Math.round(unitCount * quote.closeCents)
      : null;

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);
    if (quote === null || !Number.isFinite(unitCount) || unitCount <= 0) {
      setFormError("Enter a ticker and how many shares. The close has to load first.");
      return;
    }
    setPending(true);
    try {
      await api.buy({ symbol: quote.symbol, name: name.trim() || quote.name, units: unitCount });
      navigate("/invest");
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : "The buy did not land.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <BackLink to="/invest" label="Back to Investments" />
          <h1 className="screen-title">Buy</h1>
        </header>
        <form className="panel" onSubmit={(event) => void onSubmit(event)}>
          <div className="field">
            <span id="symbol-label">Share</span>
            <Dropdown
              options={
                shares === null
                  ? null
                  : shares.map((share) => ({ value: share.symbol, label: share.name }))
              }
              value={symbol}
              listLabel="NSE shares"
              onChange={(next) => {
                const share = shares?.find((row) => row.symbol === next);
                if (share === undefined) return;
                setSymbol(share.symbol);
                setName(share.name);
                setNameTouched(true);
              }}
            />
            <input className="dropdown-required" tabIndex={-1} value={symbol} required aria-labelledby="symbol-label" readOnly />
          </div>
          <label className="field">
            Name
            <input
              value={name}
              onChange={(event) => {
                setNameTouched(true);
                setName(event.target.value);
              }}
              required
              maxLength={80}
            />
          </label>
          <label className="field">
            Units
            <input inputMode="decimal" value={units} onChange={(event) => setUnits(event.target.value)} required />
          </label>
          <div className="field">
            <span>Close</span>
            {quote !== null ? (
              <>
                <p className="money">{formatKes(quote.closeCents)}</p>
                <p className="meta">
                  {formatSession(quote.closeSession)}
                  {quote.dayChangeBps !== null ? ` · ${formatDayPercent(quote.dayChangeBps)} from the close before` : ""}
                </p>
                {quote.listedCloseCents !== null && quote.fxKesPerUsd !== null ? (
                  <p className="meta">
                    {formatUsd(quote.listedCloseCents)} · {quote.fxKesPerUsd.toFixed(2)} KES per dollar
                  </p>
                ) : null}
              </>
            ) : (
              <p className="meta">The last published close fills in here.</p>
            )}
          </div>
          {costCents !== null && quote !== null ? (
            <p className="meta">
              {formatUnits(unitCount)} shares for {formatKes(costCents)} at the {formatSession(quote.closeSession)} close.
            </p>
          ) : null}
          {listError !== null ? (
            <p className="alert" role="alert">
              {listError}
            </p>
          ) : null}
          {quoteError !== null ? (
            <p className="alert" role="alert">
              {quoteError}
            </p>
          ) : null}
          {formError !== null ? (
            <p className="alert" role="alert">
              {formError}
            </p>
          ) : null}
          <button className="primary" type="submit" disabled={pending || quote === null}>
            {pending ? "…" : "Buy"}
          </button>
        </form>
      </main>
      <Nav />
    </>
  );
}
