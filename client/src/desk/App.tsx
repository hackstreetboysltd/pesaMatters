import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { LoanApplication } from "../api";
import { AmountField } from "../components/AmountField";
import { Nav } from "../components/Nav";
import { MarkBook, MarkLoan, MarkYou } from "../components/marks";
import { StepForm } from "../flow/StepForm";
import { explainShillings, formatKes, shillingsToCents } from "../format";
import { deskApi, DeskError, type DeskAdmin, type DeskCapacity } from "./api";

const LINKS = [
  { to: "/queue", label: "Queue", end: true, icon: MarkBook },
  { to: "/work", label: "Desk", end: false, icon: MarkLoan },
  { to: "/you", label: "You", end: true, icon: MarkYou },
];

const STEPS = [
  { id: "details", title: "Loan details" },
  { id: "guarantors", title: "Guarantors" },
  { id: "review", title: "Review" },
  { id: "desk", title: "Desk" },
];

function afterLogin(raw: string | null): string {
  if (raw === null || !raw.startsWith("/desk/") || raw.startsWith("/desk/login")) return "/queue";
  return raw.slice("/desk".length);
}

export function DeskApp(): React.ReactElement {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="app-frame">
        <Routes>
          <Route path="/login" element={<DeskLogin />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/work" element={<Work />} />
          <Route path="/work/:id" element={<Work />} />
          <Route path="/you" element={<You />} />
          <Route path="*" element={<Navigate to="/queue" replace />} />
        </Routes>
      </div>
    </>
  );
}

function DeskLogin(): React.ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await deskApi.login({ email: email.trim().toLowerCase(), password });
      navigate(afterLogin(params.get("returnTo")), { replace: true });
    } catch (caught) {
      setError(caught instanceof DeskError ? caught.message : "Sign-in did not finish.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="screen" id="main">
      <header className="screen-head">
        <h1 className="screen-title">Desk</h1>
      </header>
      <form className="panel" onSubmit={(event) => void onSubmit(event)}>
        <label className="field">
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={10}
            autoComplete="current-password"
          />
        </label>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function Queue(): React.ReactElement {
  const [rows, setRows] = useState<LoanApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    deskApi
      .queue()
      .then((payload) => {
        if (active) setRows(payload.applications);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof DeskError ? caught.message : "Could not load the queue.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Queue</h1>
        </header>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {rows !== null && rows.length === 0 ? <p className="meta">Nothing is waiting.</p> : null}
        <div className="panel">
          {rows?.map((row) => (
            <Link key={row.id} className="loan-line" to={`/work/${row.id}`}>
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
      </main>
      <Nav links={LINKS} />
    </>
  );
}

function Work(): React.ReactElement {
  const { id } = useParams();
  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [capacity, setCapacity] = useState<DeskCapacity | null>(null);
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
    deskApi
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
        if (active) setError(caught instanceof DeskError ? caught.message : "Could not open that loan.");
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function refresh(next: LoanApplication): Promise<void> {
    setApplication(next);
    if (id === undefined) return;
    const loaded = await deskApi.loan(id);
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
      const result = await deskApi.appraise(id, { recommendedCents: cents, notes: notes.trim(), riskRating: risk });
      setNotes("");
      await refresh(result.application);
    } catch (caught) {
      setError(caught instanceof DeskError ? caught.message : "Appraisal did not land.");
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
      const result = await deskApi.decide(id, body);
      setNotes("");
      await refresh(result.application);
    } catch (caught) {
      setError(caught instanceof DeskError ? caught.message : "That decision did not land.");
    } finally {
      setPending(false);
    }
  }

  async function onDisburse(): Promise<void> {
    if (id === undefined) return;
    setPending(true);
    setError(null);
    try {
      const result = await deskApi.disburse(id);
      await refresh(result.application);
    } catch (caught) {
      setError(caught instanceof DeskError ? caught.message : "The payout did not start.");
    } finally {
      setPending(false);
    }
  }

  if (id === undefined) {
    return (
      <>
        <main className="screen" id="main">
          <h1 className="screen-title">Desk</h1>
          <p className="meta">Pick a loan from the queue.</p>
        </main>
        <Nav links={LINKS} />
      </>
    );
  }

  return (
    <>
      <main className="screen" id="main">
        {application === null && error === null ? <p className="meta">Loading.</p> : null}
        {application !== null ? (
          <StepForm steps={STEPS} step={step} {...(step > 0 ? { onBack: () => setStep((value) => value - 1) } : {})}>
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
  const [admin, setAdmin] = useState<DeskAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    deskApi
      .me()
      .then((payload) => {
        if (active) setAdmin(payload.admin);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof DeskError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof DeskError ? caught.message : "Could not load the desk.");
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function signOut(): Promise<void> {
    await deskApi.logout();
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
