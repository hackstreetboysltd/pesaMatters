import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, type LoanApplication } from "../api";
import {
  beginAdminGoogleSignIn,
  claimOauthCompletion,
  clearAdminGooglePending,
  hasOauthHandoffParams,
  pendingMatches,
  readAdminGooglePending,
} from "../auth/googleStart";
import { AmountField } from "../components/AmountField";
import { Nav } from "../components/Nav";
import { MarkCrew, MarkHome, MarkInvest, MarkLoan, MarkMove, MarkYou } from "../components/marks";
import { StepForm } from "../flow/StepForm";
import { explainShillings, formatKes, shillingsToCents } from "../format";
import { safeAdminReturnTo } from "../returnTo";
import {
  AdminError,
  adminApi,
  type AdminCapacity,
  type AdminOverview,
  type AdminUser,
  type CrewRow,
  type InvestmentRow,
  type LoanProduct,
  type PaymentRow,
  type TreasurySnapshot,
} from "./api";

const LINKS = [
  { to: "/", label: "Dashboard", end: true, icon: MarkHome },
  { to: "/crew", label: "Crew", end: true, icon: MarkCrew },
  { to: "/money", label: "Money", end: false, icon: MarkMove },
  { to: "/loans", label: "Loans", end: false, icon: MarkLoan },
  { to: "/you", label: "You", end: true, icon: MarkYou },
];

const WORK_STEPS = [
  { id: "details", title: "Loan details" },
  { id: "guarantors", title: "Guarantors" },
  { id: "review", title: "Review" },
  { id: "decide", title: "Decide" },
];

const ERRORS: Record<string, string> = {
  google: "Google sign-in did not finish. Try again.",
  google_off: "Google sign-in needs a client id and secret in the server environment.",
  google_unconfigured: "Google sign-in needs a client id and secret in the server environment.",
  google_denied: "Google sign-in was cancelled.",
  google_failed: "Google sign-in did not finish. Try again.",
  google_cookie: "That sign-in expired. Try Continue with Google again.",
  google_state: "That sign-in expired. Try Continue with Google again.",
  google_rejected: "Google rejected that sign-in. Reload the page and try again.",
  google_client: "Google rejected the client secret. Check it in the server environment and restart the API.",
  google_redirect: "The Google redirect address does not match this app.",
  google_network: "Could not reach Google. Check the network, then try again.",
  google_clock: "This device's clock is wrong. Set the correct date and time, then try again.",
  google_conflict: "That Google email is already tied to another admin.",
  not_admin: "That Google account is not an admin on this pot.",
  email_unverified: "That Google account has not verified its email.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  csrf: "Refresh the page and try again.",
};

const FALLBACK = "Google sign-in did not finish. Try again.";

function afterLogin(raw: string | null): string {
  return safeAdminReturnTo(raw, "/");
}

export function AdminApp(): React.ReactElement {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="app-frame">
        <Routes>
          <Route path="/login" element={<AdminLogin />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/crew" element={<Crew />} />
          <Route path="/money" element={<Money />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/loans/:id" element={<LoanWork />} />
          <Route path="/you" element={<You />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  );
}

function AdminLogin(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = afterLogin(params.get("returnTo"));
  const completing = hasOauthHandoffParams(location.search);
  const [startError, setStartError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const queryError = params.get("error");
  const error = completing ? undefined : (messageFor(queryError) ?? startError ?? undefined);

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    const code = search.get("code");
    const state = search.get("state");
    if (code === null || state === null || code.length === 0 || state.length === 0) return;
    if (!claimOauthCompletion(state, code)) return;
    const pending = readAdminGooglePending();
    if (pending === null || !pendingMatches(pending, state)) {
      clearAdminGooglePending();
      navigate("/login?error=google_state", { replace: true });
      return;
    }
    const next = pending.returnTo;
    void (async () => {
      try {
        await adminApi.googleCallback({ code, verifier: pending.verifier });
        clearAdminGooglePending();
        navigate(next, { replace: true });
      } catch (err) {
        clearAdminGooglePending();
        const name = err instanceof AdminError || err instanceof ApiError ? err.code : "google_network";
        navigate(`/login?error=${allow(name)}`, { replace: true });
      }
    })();
  }, [location.search, navigate]);

  async function onGoogle(): Promise<void> {
    setStartError(null);
    setLeaving(true);
    try {
      await beginAdminGoogleSignIn(returnTo, () => adminApi.googleConfig());
    } catch (err) {
      setLeaving(false);
      const name = err instanceof AdminError || err instanceof ApiError ? err.code : "google_network";
      setStartError(messageFor(name) ?? FALLBACK);
    }
  }

  return (
    <main className="screen" id="main">
      <header className="screen-head">
        <h1 className="screen-title">Admin</h1>
      </header>
      <div className="panel">
        <p className="meta">Ops for the whole pot. Continue with a Google account already on the admin list.</p>
        {error !== undefined ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        <button className="google-continue" type="button" disabled={leaving || completing} onClick={() => void onGoogle()}>
          <GoogleMark />
          Continue with Google
        </button>
      </div>
    </main>
  );
}

function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let active = true;
    adminApi
      .overview()
      .then((payload) => {
        if (active) setOverview(payload);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof AdminError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof AdminError ? caught.message : "Could not load the dashboard.");
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function onVerify(): Promise<void> {
    setVerifying(true);
    setError(null);
    try {
      const result = await adminApi.ledgerVerify();
      setOverview((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              ledger: result,
              health: result.ok && prev.failedPaymentsWeek === 0 && prev.pendingPayments <= 5 ? "live" : "degraded",
            },
      );
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : "Ledger check did not finish.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Dashboard</h1>
          {overview !== null ? (
            <p className={`admin-health ${overview.health}`}>{overview.health === "live" ? "Live" : "Degraded"}</p>
          ) : null}
        </header>
        <p className="meta">Tap a card. Jump in.</p>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {overview !== null ? (
          <>
            <div className="admin-stat-grid">
              <button type="button" className="admin-stat" onClick={() => navigate("/crew")}>
                <span className="admin-stat-label">Crew</span>
                <span className="admin-stat-value">{overview.crewCount}</span>
                <span className="admin-stat-hint">{overview.crewCount === 0 ? "None onboarded" : "On the pot"}</span>
              </button>
              <button type="button" className="admin-stat" onClick={() => navigate("/money")}>
                <span className="admin-stat-label">Cash</span>
                <span className="admin-stat-value">{formatKes(overview.cashCents)}</span>
                <span className="admin-stat-hint">Treasury</span>
              </button>
              <button
                type="button"
                className={`admin-stat${overview.pendingPayments > 0 || overview.failedPaymentsWeek > 0 ? " hot" : ""}`}
                onClick={() => navigate("/money?lane=payments")}
              >
                <span className="admin-stat-label">Payments</span>
                <span className="admin-stat-value">{overview.pendingPayments}</span>
                <span className="admin-stat-hint">
                  {overview.failedPaymentsWeek > 0
                    ? `${overview.failedPaymentsWeek} failed this week`
                    : overview.pendingPayments === 0
                      ? "All clear"
                      : "Pending"}
                </span>
              </button>
              <button
                type="button"
                className={`admin-stat${overview.openLoans > 0 ? " hot" : ""}`}
                onClick={() => navigate("/loans")}
              >
                <span className="admin-stat-label">Loans</span>
                <span className="admin-stat-value">{overview.openLoans}</span>
                <span className="admin-stat-hint">{overview.openLoans === 0 ? "Nothing waiting" : "Open in queue"}</span>
              </button>
            </div>
            <div className="panel">
              <p className="meta">
                Ledger · {overview.ledger.ok ? `${overview.ledger.length} blocks · intact` : overview.ledger.reason}
              </p>
              <button className="ghost" type="button" disabled={verifying} onClick={() => void onVerify()}>
                {verifying ? "…" : "Verify ledger"}
              </button>
            </div>
          </>
        ) : null}
      </main>
      <Nav links={LINKS} />
    </>
  );
}

function Crew(): React.ReactElement {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CrewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .crew()
      .then((payload) => {
        if (active) setRows(payload.crew);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof AdminError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof AdminError ? caught.message : "Could not load the crew.");
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Crew</h1>
        </header>
        <p className="meta">{rows === null ? "…" : rows.length === 0 ? "No crew yet." : `${rows.length} members`}</p>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        <div className="panel">
          {rows?.map((row) => (
            <div key={row.id} className="loan-line">
              <span>
                {row.name}
                <br />
                <span className="meta">
                  {row.email} · {formatKes(row.claimCents)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </main>
      <Nav links={LINKS} />
    </>
  );
}

type MoneyLane = "treasury" | "payments" | "invest";

function Money(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = params.get("lane");
  const [lane, setLane] = useState<MoneyLane>(
    initial === "payments" || initial === "invest" ? initial : "treasury",
  );
  const [treasury, setTreasury] = useState<TreasurySnapshot | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [investments, setInvestments] = useState<InvestmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (lane === "treasury") {
          const payload = await adminApi.treasury();
          if (active) setTreasury(payload);
        } else if (lane === "payments") {
          const payload = await adminApi.payments();
          if (active) setPayments(payload.payments);
        } else {
          const payload = await adminApi.investments();
          if (active) setInvestments(payload.investments);
        }
      } catch (caught) {
        if (!active) return;
        if (caught instanceof AdminError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof AdminError ? caught.message : "Could not load money.");
      }
    })();
    return () => {
      active = false;
    };
  }, [lane, navigate]);

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Money</h1>
        </header>
        <div className="admin-lanes" role="tablist" aria-label="Money lanes">
          <button type="button" role="tab" aria-selected={lane === "treasury"} onClick={() => setLane("treasury")}>
            Treasury
          </button>
          <button type="button" role="tab" aria-selected={lane === "payments"} onClick={() => setLane("payments")}>
            Payments
          </button>
          <button type="button" role="tab" aria-selected={lane === "invest"} onClick={() => setLane("invest")}>
            Invest
          </button>
        </div>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {lane === "treasury" && treasury !== null ? (
          <>
            <p className="meta">
              Cash {formatKes(treasury.cashCents)} · Claims {formatKes(treasury.claimsTotalCents)}
            </p>
            <div className="panel">
              {treasury.claims.length === 0 ? <p className="meta">No claims yet.</p> : null}
              {treasury.claims.map((row) => (
                <div key={row.memberId} className="loan-line">
                  <span>
                    {row.name}
                    <br />
                    <span className="meta">{formatKes(row.claimCents)}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {lane === "payments" && payments !== null ? (
          <div className="panel">
            {payments.length === 0 ? <p className="meta">No payments yet.</p> : null}
            {payments.map((row) => (
              <div key={row.id} className="loan-line">
                <span>
                  {row.memberName}
                  <br />
                  <span className="meta">
                    {row.kind} · {formatKes(row.amountCents)} · {row.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {lane === "invest" && investments !== null ? (
          <div className="panel">
            {investments.length === 0 ? <p className="meta">No holdings yet.</p> : null}
            {investments.map((row) => (
              <div key={row.id} className="loan-line">
                <span>
                  {row.symbol} · {row.name}
                  <br />
                  <span className="meta">
                    {row.units} u · {formatKes(row.valueCents)} · {formatKes(row.gainCents)} gain
                  </span>
                </span>
                <MarkInvest />
              </div>
            ))}
          </div>
        ) : null}
      </main>
      <Nav links={LINKS} />
    </>
  );
}

function Loans(): React.ReactElement {
  const navigate = useNavigate();
  const [lane, setLane] = useState<"queue" | "products">("queue");
  const [rows, setRows] = useState<LoanApplication[] | null>(null);
  const [products, setProducts] = useState<LoanProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (lane === "queue") {
          const payload = await adminApi.loans();
          if (active) setRows(payload.applications);
        } else {
          const payload = await adminApi.products();
          if (active) setProducts(payload.products);
        }
      } catch (caught) {
        if (!active) return;
        if (caught instanceof AdminError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof AdminError ? caught.message : "Could not load loans.");
      }
    })();
    return () => {
      active = false;
    };
  }, [lane, navigate]);

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Loans</h1>
        </header>
        <div className="admin-lanes" role="tablist" aria-label="Loan lanes">
          <button type="button" role="tab" aria-selected={lane === "queue"} onClick={() => setLane("queue")}>
            Queue
          </button>
          <button type="button" role="tab" aria-selected={lane === "products"} onClick={() => setLane("products")}>
            Products
          </button>
        </div>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {lane === "queue" ? (
          <div className="panel">
            {rows !== null && rows.length === 0 ? <p className="meta">Nothing is waiting.</p> : null}
            {rows?.map((row) => (
              <Link key={row.id} className="loan-line" to={`/loans/${row.id}`}>
                <span>
                  {row.memberName}
                  <br />
                  <span className="meta">
                    {row.productName} · {formatKes(row.amountCents)} · {row.status.replaceAll("_", " ")}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="panel">
            {products?.map((product) => (
              <div key={product.code} className="loan-line">
                <span>
                  {product.name}
                  <br />
                  <span className="meta">
                    {product.code} · {product.interestPercent}% · {formatKes(product.minimumCents)}–
                    {formatKes(product.maximumCents)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
      <Nav links={LINKS} />
    </>
  );
}

function LoanWork(): React.ReactElement {
  const { id } = useParams();
  const navigate = useNavigate();
  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [capacity, setCapacity] = useState<AdminCapacity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(3);
  const [recommended, setRecommended] = useState("");
  const [notes, setNotes] = useState("");
  const [risk, setRisk] = useState<"low" | "medium" | "high">("medium");
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (id === undefined) return;
    let active = true;
    adminApi
      .loan(id)
      .then((payload) => {
        if (!active) return;
        setApplication(payload.application);
        setCapacity(payload.capacity);
        setError(null);
        const suggested = payload.application.recommendedCents ?? payload.application.amountCents;
        setRecommended(String(suggested / 100));
        setAmount(String((payload.application.approvedCents ?? suggested) / 100));
        setTerm(String(payload.application.approvedTerm ?? payload.application.termCount));
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof AdminError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof AdminError ? caught.message : "Could not open that loan.");
      });
    return () => {
      active = false;
    };
  }, [id, navigate]);

  async function refresh(next: LoanApplication): Promise<void> {
    setApplication(next);
    if (id === undefined) return;
    const loaded = await adminApi.loan(id);
    setApplication(loaded.application);
    setCapacity(loaded.capacity);
  }

  async function onAppraise(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (id === undefined) return;
    const cents = shillingsToCents(recommended);
    const problem = explainShillings(recommended, { wholeOnly: true });
    if (problem !== null || cents === null) {
      setError(problem ?? "Enter the recommended amount in whole KES.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await adminApi.appraise(id, { recommendedCents: cents, notes: notes.trim(), riskRating: risk });
      setNotes("");
      await refresh(result.application);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : "Appraisal did not land.");
    } finally {
      setPending(false);
    }
  }

  async function onDecide(decision: "approve" | "reject"): Promise<void> {
    if (id === undefined) return;
    const cents = shillingsToCents(amount);
    if (decision === "approve") {
      const problem = explainShillings(amount, { wholeOnly: true });
      if (problem !== null || cents === null) {
        setError(problem ?? "Enter the approved amount in whole KES.");
        return;
      }
    }
    setPending(true);
    setError(null);
    try {
      const body =
        decision === "approve" && cents !== null
          ? { decision, amountCents: cents, termCount: Number(term), notes: notes.trim() }
          : { decision, notes: notes.trim() };
      const result = await adminApi.decide(id, body);
      setNotes("");
      await refresh(result.application);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : "That decision did not land.");
    } finally {
      setPending(false);
    }
  }

  async function onDisburse(): Promise<void> {
    if (id === undefined) return;
    setPending(true);
    setError(null);
    try {
      const result = await adminApi.disburse(id);
      await refresh(result.application);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : "The payout did not start.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Loan</h1>
          <Link className="meta" to="/loans">
            Back to queue
          </Link>
        </header>
        {application === null && error === null ? <p className="meta">Loading.</p> : null}
        {application !== null ? (
          <StepForm steps={WORK_STEPS} step={step} {...(step > 0 ? { onBack: () => setStep((value) => value - 1) } : {})}>
            {step === 0 ? (
              <div className="panel">
                <p className="meta">{application.memberName}</p>
                <p className="money">{formatKes(application.amountCents)}</p>
                <p className="meta">
                  {application.productName} · {application.termCount} {application.termUnit}
                </p>
                <p className="meta">{application.purpose}</p>
                {capacity !== null ? <p className="meta">Free deposits {formatKes(capacity.freeCents)}.</p> : null}
              </div>
            ) : null}
            {step === 1 ? (
              <div className="panel">
                {application.guarantors.length === 0 ? <p className="meta">No guarantors.</p> : null}
                {application.guarantors.map((row) => (
                  <p key={row.id} className="meta">
                    {row.name} · {formatKes(row.amountCents)} · {row.status}
                  </p>
                ))}
                <p className="meta">
                  Cover {formatKes(application.coverage.acceptedCents)} of {formatKes(application.coverage.requiredCents)}.
                </p>
              </div>
            ) : null}
            {step === 2 ? (
              <div className="panel">
                <p className="meta">{application.purpose}</p>
                <p className="meta">Phone {application.phone}</p>
              </div>
            ) : null}
            {step === 3 ? (
              <div className="panel">
                <p className="meta">{application.status.replaceAll("_", " ")}</p>
                {application.status === "under_appraisal" ? (
                  <form className="panel" onSubmit={(event) => void onAppraise(event)}>
                    <AmountField label="Recommend" value={recommended} onChange={setRecommended} required />
                    <label className="field">
                      Risk
                      <select value={risk} onChange={(event) => setRisk(event.target.value as "low" | "medium" | "high")}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                    <label className="field">
                      Notes
                      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} required minLength={10} maxLength={2000} />
                    </label>
                    <button className="primary" type="submit" disabled={pending}>
                      Appraise
                    </button>
                  </form>
                ) : null}
                {application.status === "awaiting_approval" ? (
                  <form
                    className="panel"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onDecide("approve");
                    }}
                  >
                    <AmountField label="Approve" value={amount} onChange={setAmount} required />
                    <label className="field">
                      Term
                      <input inputMode="numeric" value={term} onChange={(event) => setTerm(event.target.value)} required />
                    </label>
                    <label className="field">
                      Notes
                      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} required minLength={5} maxLength={1000} />
                    </label>
                    <div className="loan-actions">
                      <button className="ghost" type="button" disabled={pending} onClick={() => void onDecide("reject")}>
                        Reject
                      </button>
                      <button className="primary" type="submit" disabled={pending}>
                        Approve
                      </button>
                    </div>
                  </form>
                ) : null}
                {application.status === "approved" ? (
                  <button className="primary" type="button" disabled={pending} onClick={() => void onDisburse()}>
                    {pending ? "…" : "Disburse"}
                  </button>
                ) : null}
                {application.status === "disbursed" ? (
                  <p className="meta">Paid out {formatKes(application.loan?.netCents ?? 0)}. The pot was not credited.</p>
                ) : null}
                {application.status === "awaiting_guarantors" ? <p className="meta">Waiting on guarantors.</p> : null}
                {application.status === "rejected" ? <p className="meta">{application.decisionNotes}</p> : null}
              </div>
            ) : null}
            {step < 3 ? (
              <button className="primary" type="button" onClick={() => setStep((value) => value + 1)}>
                Next
              </button>
            ) : null}
          </StepForm>
        ) : null}
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
      </main>
      <Nav links={LINKS} />
    </>
  );
}

function You(): React.ReactElement {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .me()
      .then((payload) => {
        if (active) setAdmin(payload.admin);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof AdminError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof AdminError ? caught.message : "Could not load admin.");
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function signOut(): Promise<void> {
    await adminApi.logout();
    navigate("/login", { replace: true });
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">You</h1>
        </header>
        {admin !== null ? (
          <div className="panel">
            <p className="meta">{admin.name}</p>
            <p className="meta">{admin.email}</p>
            <p className="meta">
              Open loans from the <Link to="/loans">Loans</Link> queue.
            </p>
            <button className="primary" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : null}
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
      </main>
      <Nav links={LINKS} />
    </>
  );
}

function allow(code: string): string {
  return Object.prototype.hasOwnProperty.call(ERRORS, code) ? code : "google";
}

function messageFor(code: string | null): string | undefined {
  if (code === null) return undefined;
  if (Object.prototype.hasOwnProperty.call(ERRORS, code)) return ERRORS[code];
  return FALLBACK;
}

function GoogleMark(): React.ReactElement {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.7-6.6 7.1l.1.1 6.3 5.3C36.9 41.4 44 36 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
