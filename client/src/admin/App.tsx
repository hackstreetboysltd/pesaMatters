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
import { BackLink } from "../components/BackLink";
import { Dropdown } from "../components/Dropdown";
import { QuantityField } from "../components/QuantityField";
import { ModeSwitch } from "../components/ModeSwitch";
import { Nav } from "../components/Nav";
import { Pager } from "../components/Pager";
import { Sheet } from "../components/Sheet";
import {
  MarkBook,
  MarkGroup,
  MarkHome,
  MarkInvest,
  MarkLoan,
  MarkMove,
  MarkPlus,
} from "../components/marks";
import { StepForm } from "../flow/StepForm";
import {
  explainShillings,
  formatDayPercent,
  formatKes,
  formatNairobiDay,
  formatNoticeDay,
  formatNoticeTime,
  formatPersonName,
  formatSession,
  formatUnits,
  formatUsd,
  shillingsToCents,
} from "../format";
import { pageWindow } from "../paging";
import { safeAdminReturnTo } from "../returnTo";
import {
  AdminError,
  adminApi,
  type AdminCapacity,
  type CloseQuote,
  type GroupRow,
  type InvestmentDetail,
  type InvestmentRow,
  type ListedShare,
  type LoanProduct,
  type PaymentRow,
  type ProductInput,
  type TreasurySnapshot,
} from "./api";
import { Ledger as LedgerPage } from "./Ledger";

const LINKS = [
  { to: "/", label: "Home", end: true, icon: MarkHome },
  { to: "/money", label: "Money", end: false, icon: MarkMove },
  { to: "/invest", label: "Invest", end: false, icon: MarkInvest },
  { to: "/loans", label: "Loans", end: false, icon: MarkLoan },
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
  google_network: "Could not reach Google. Check the network or pause the VPN, then try again.",
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

function NoticeWhen({ at }: { at: string }): React.ReactElement {
  return (
    <time className="notice-when" dateTime={at}>
      <span className="notice-day">{formatNoticeDay(at)}</span>
      <span className="notice-clock">{formatNoticeTime(at)}</span>
    </time>
  );
}

function AdminSignOut(): React.ReactElement {
  const navigate = useNavigate();

  async function onSignOut(): Promise<void> {
    try {
      await adminApi.logout();
    } catch {
      /* still clear the local session */
    }
    navigate("/login", { replace: true });
  }

  return (
    <button type="button" className="icon-btn" aria-label="Log out" onClick={() => void onSignOut()}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
        <path d="M16 16l4-4-4-4" />
        <path d="M20 12H10" />
      </svg>
    </button>
  );
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
          <Route path="/ledger" element={<LedgerPage navLinks={LINKS} />} />
          <Route path="/group" element={<Navigate to="/" replace />} />
          <Route path="/money" element={<Money />} />
          <Route path="/invest" element={<Invest />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/loans/:id" element={<LoanWork />} />
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
        <a className="portal-switch" href="/login">
          User portal
        </a>
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

const DASH_MODULES = [
  { id: "members", label: "Members", icon: MarkGroup },
  { id: "money", to: "/money", label: "Money", icon: MarkMove },
  { id: "invest", to: "/invest", label: "Investments", icon: MarkInvest },
  { id: "loans", to: "/loans", label: "Loans", icon: MarkLoan },
] as const;

function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const membersOpen = params.get("members") !== null;

  function openMembers(): void {
    setParams({ members: "1" });
  }

  function closeMembers(): void {
    setParams({});
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <Link className="pot-chain" to="/ledger" aria-label="Ledger">
            <MarkBook />
          </Link>
          <h1 className="screen-title">Dashboard</h1>
          <AdminSignOut />
        </header>
        <div className="admin-mod-grid">
          {DASH_MODULES.map((mod, index) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                type="button"
                className="admin-mod-tile"
                style={{ "--tile-i": index } as React.CSSProperties}
                onClick={() => {
                  if (mod.id === "members") openMembers();
                  else navigate(mod.to);
                }}
              >
                <span className="admin-mod-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span className="admin-mod-name">{mod.label}</span>
              </button>
            );
          })}
        </div>
      </main>
      <Nav links={LINKS} />
      {membersOpen ? <MembersModal onClose={closeMembers} /> : null}
    </>
  );
}

function MembersModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const navigate = useNavigate();
  const [rows, setRows] = useState<GroupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    adminApi
      .group()
      .then((payload) => {
        if (active) setRows(payload.group);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof AdminError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof AdminError ? caught.message : "Could not load the group.");
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const members = rows ?? [];
  const slice = pageWindow(members.length, page);
  const pageRows = members.slice(slice.start, slice.end);

  useEffect(() => {
    if (page !== slice.page) setPage(slice.page);
  }, [page, slice.page]);

  return (
    <Sheet title="Members" onClose={onClose} className="members-modal" backdropClassName="members-backdrop">
      {error !== null ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="panel members-modal-body">
        {rows !== null && members.length === 0 ? <p className="meta">No group yet.</p> : null}
        {rows !== null && members.length > 0 ? (
          <ul className="notice-list">
            {pageRows.map((row) => (
              <li key={row.id} className="notice-row">
                <div className="notice-copy">
                  <p className="notice-title">{formatPersonName(row.name)}</p>
                  <p className="notice-detail">{row.email}</p>
                </div>
                <NoticeWhen at={row.createdAt} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {rows !== null ? <Pager label="Member pages" total={members.length} slice={slice} onPage={setPage} /> : null}
    </Sheet>
  );
}

type MoneyLane = "treasury" | "deposits" | "draws";

function moneyLane(value: string | null): MoneyLane {
  if (value === "draws") return "draws";
  if (value === "deposits" || value === "payments") return "deposits";
  return "treasury";
}

function paymentStatusLabel(row: PaymentRow): string {
  if (row.awaitingApproval) return "awaiting approval";
  return row.status;
}

function Money(): React.ReactElement {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initial = params.get("lane");
  const lane = moneyLane(initial);

  function selectLane(next: MoneyLane): void {
    if (next === "treasury") setParams({}, { replace: true });
    else setParams({ lane: next }, { replace: true });
  }
  const [treasury, setTreasury] = useState<TreasurySnapshot | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setError(null);
        if (lane === "treasury") {
          const payload = await adminApi.treasury();
          if (active) setTreasury(payload);
        } else {
          const payload = await adminApi.payments();
          if (active) setPayments(payload.payments);
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
  }, [lane, navigate, reloadKey]);

  const claims = treasury?.claims ?? [];
  const paymentRows = (payments ?? []).filter((row) =>
    lane === "deposits" ? row.kind === "deposit" : (row.kind === "withdraw" || row.kind === "loan_out"),
  );
  const listTotal = lane === "treasury" ? claims.length : paymentRows.length;
  const listReady = lane === "treasury" ? treasury !== null : payments !== null;
  const slice = pageWindow(listTotal, page);
  const claimPage = claims.slice(slice.start, slice.end);
  const paymentPage = paymentRows.slice(slice.start, slice.end);

  useEffect(() => {
    setPage(0);
  }, [lane]);

  useEffect(() => {
    if (page !== slice.page) setPage(slice.page);
  }, [page, slice.page]);

  if (initial === "invest") {
    return <Navigate to="/invest" replace />;
  }

  async function onWithdrawDecision(id: string, decision: "approve" | "reject"): Promise<void> {
    setActingId(id);
    setError(null);
    try {
      if (decision === "approve") await adminApi.approveWithdraw(id);
      else await adminApi.rejectWithdraw(id);
      setReloadKey((n) => n + 1);
    } catch (caught) {
      if (caught instanceof AdminError && caught.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setError(caught instanceof AdminError ? caught.message : "Could not update that withdrawal.");
    } finally {
      setActingId(null);
    }
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Money</h1>
        </header>
        <ModeSwitch
          label="Money"
          variant="tabs"
          value={lane}
          options={[
            ["treasury", "Balances"],
            ["deposits", "Deposits"],
            ["draws", "Draws"],
          ]}
          onChange={selectLane}
        />
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {lane === "treasury" && treasury !== null ? (
          <section className="panel" role="tabpanel" id="panel-treasury" aria-labelledby="tab-treasury">
            {claims.length === 0 ? <p className="meta">No claims yet.</p> : null}
            {claims.length > 0 ? (
              <ul className="notice-list">
                {claimPage.map((row) => (
                  <li key={row.memberId} className="notice-row">
                    <div className="notice-copy">
                      <p className="notice-title">{formatPersonName(row.name)}</p>
                      <p className="notice-detail">{formatKes(row.claimCents)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
        {(lane === "deposits" || lane === "draws") && payments !== null ? (
          <section className="panel" role="tabpanel" id={`panel-${lane}`} aria-labelledby={`tab-${lane}`}>
            {paymentRows.length === 0 ? (
              <p className="meta">{lane === "deposits" ? "No deposits yet." : "No draws yet."}</p>
            ) : null}
            {paymentRows.length > 0 ? (
              <ul className="notice-list">
                {paymentPage.map((row) => (
                  <li key={row.id} className="notice-row">
                    <div className="notice-copy">
                      <p className="notice-title">{formatPersonName(row.memberName)}</p>
                      <p className="notice-detail">
                        {row.kind} · {formatKes(row.amountCents)} · {paymentStatusLabel(row)}
                      </p>
                      {row.awaitingApproval ? (
                        <div className="loan-actions">
                          <button
                            type="button"
                            className="ghost"
                            disabled={actingId === row.id}
                            onClick={() => void onWithdrawDecision(row.id, "reject")}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className="primary"
                            disabled={actingId === row.id}
                            onClick={() => void onWithdrawDecision(row.id, "approve")}
                          >
                            {actingId === row.id ? "…" : "Approve"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <NoticeWhen at={row.createdAt} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
        {listReady ? <Pager label="Money pages" total={listTotal} slice={slice} onPage={setPage} /> : null}
      </main>
      <Nav links={LINKS} />
    </>
  );
}

function Invest(): React.ReactElement {
  const navigate = useNavigate();
  const [investments, setInvestments] = useState<InvestmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setError(null);
        const payload = await adminApi.investments();
        if (active) setInvestments(payload.investments);
      } catch (caught) {
        if (!active) return;
        if (caught instanceof AdminError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setError(caught instanceof AdminError ? caught.message : "Could not load investments.");
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate, reloadKey]);

  const holdingRows = investments ?? [];
  const slice = pageWindow(holdingRows.length, page);
  const holdingPage = holdingRows.slice(slice.start, slice.end);

  useEffect(() => {
    if (page !== slice.page) setPage(slice.page);
  }, [page, slice.page]);

  if (buying) {
    return (
      <>
        <main className="screen" id="main">
          <InvestBuyFlow
            onClose={() => setBuying(false)}
            onBought={() => {
              setBuying(false);
              setReloadKey((n) => n + 1);
            }}
          />
        </main>
        <Nav links={LINKS} />
      </>
    );
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Investments</h1>
          <div className="screen-head-end">
            <button type="button" className="icon-btn" aria-label="Buy investment" onClick={() => setBuying(true)}>
              <MarkPlus />
            </button>
          </div>
        </header>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {investments !== null ? (
          <section className="panel">
            {holdingRows.length === 0 ? <p className="meta">No holdings yet. Tap + to buy.</p> : null}
            {holdingRows.length > 0 ? (
              <div className="notice-list">
                {holdingPage.map((row) => (
                  <button key={row.id} type="button" className="notice-row" onClick={() => setDetailId(row.id)}>
                    <div className="notice-copy">
                      <p className="notice-title">
                        {row.symbol} · {row.name}
                      </p>
                      <p className="notice-detail">
                        {row.units} u · {formatKes(row.valueCents)} · {formatKes(row.gainCents)} gain
                      </p>
                    </div>
                    <NoticeWhen at={row.openedAt} />
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {investments !== null ? (
          <Pager label="Invest pages" total={holdingRows.length} slice={slice} onPage={setPage} />
        ) : null}
      </main>
      <Nav links={LINKS} />
      {detailId !== null ? <InvestDetailSheet id={detailId} onClose={() => setDetailId(null)} /> : null}
    </>
  );
}

function Loans(): React.ReactElement {
  const navigate = useNavigate();
  const [lane, setLane] = useState<"queue" | "products">("products");
  const [rows, setRows] = useState<LoanApplication[] | null>(null);
  const [products, setProducts] = useState<LoanProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<"new" | LoanProduct | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setError(null);
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
  }, [lane, navigate, reloadKey]);

  const queue = rows ?? [];
  const productRows = products ?? [];
  const listTotal = lane === "queue" ? queue.length : productRows.length;
  const listReady = lane === "queue" ? rows !== null : products !== null;
  const slice = pageWindow(listTotal, page);
  const queuePage = queue.slice(slice.start, slice.end);
  const productPage = productRows.slice(slice.start, slice.end);

  useEffect(() => {
    setPage(0);
  }, [lane]);

  useEffect(() => {
    if (page !== slice.page) setPage(slice.page);
  }, [page, slice.page]);

  if (editor !== null) {
    return (
      <>
        <main className="screen" id="main">
          <ProductFlow
            initial={editor === "new" ? null : editor}
            onClose={() => setEditor(null)}
            onSaved={() => {
              setEditor(null);
              setReloadKey((n) => n + 1);
            }}
          />
        </main>
        <Nav links={LINKS} />
      </>
    );
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <h1 className="screen-title">Loans</h1>
          {lane === "products" ? (
            <div className="screen-head-end">
              <button type="button" className="icon-btn" aria-label="New product" onClick={() => setEditor("new")}>
                <MarkPlus />
              </button>
            </div>
          ) : null}
        </header>
        <ModeSwitch
          label="Loans"
          variant="tabs"
          value={lane}
          options={[
            ["products", "Products"],
            ["queue", "Pending"],
          ]}
          onChange={setLane}
        />
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {lane === "queue" ? (
          <section className="panel" role="tabpanel" id="panel-queue" aria-labelledby="tab-queue">
            {rows !== null && queue.length === 0 ? <p className="meta">Nothing is waiting.</p> : null}
            {queue.length > 0 ? (
              <div className="notice-list">
                {queuePage.map((row) => (
                  <Link key={row.id} className="notice-row" to={`/loans/${row.id}`}>
                    <div className="notice-copy">
                      <p className="notice-title">{formatPersonName(row.memberName)}</p>
                      <p className="notice-detail">
                        {row.productName} · {formatKes(row.amountCents)} · {row.status.replaceAll("_", " ")}
                      </p>
                    </div>
                    <NoticeWhen at={row.createdAt} />
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="panel" role="tabpanel" id="panel-products" aria-labelledby="tab-products">
            {products !== null && productRows.length === 0 ? <p className="meta">No products yet. Tap + to add one.</p> : null}
            {productRows.length > 0 ? (
              <div className="notice-list">
                {productPage.map((product) => (
                  <button key={product.code} type="button" className="notice-row" onClick={() => setEditor(product)}>
                    <div className="notice-copy">
                      <p className="notice-title">{product.name}</p>
                      <p className="notice-detail">
                        {product.code} · {product.interestPercent}% · {formatKes(product.minimumCents)}–
                        {formatKes(product.maximumCents)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        )}
        {listReady ? <Pager label="Loan pages" total={listTotal} slice={slice} onPage={setPage} /> : null}
      </main>
      <Nav links={LINKS} />
    </>
  );
}

function centsToShillings(cents: number): string {
  return String(cents / 100);
}

const PRODUCT_STEPS = [
  { id: "code", title: "Code" },
  { id: "name", title: "Name" },
  { id: "interest", title: "Interest" },
  { id: "term-from", title: "Term from" },
  { id: "term-to", title: "Term to" },
  { id: "term-unit", title: "Term unit" },
  { id: "minimum", title: "Minimum" },
  { id: "maximum", title: "Maximum" },
  { id: "guarantors", title: "Guarantors" },
  { id: "coverage", title: "Coverage" },
  { id: "fee", title: "Fee" },
] as const;

function ProductFlow({
  initial,
  onClose,
  onSaved,
}: {
  initial: LoanProduct | null;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const editing = initial !== null;
  const [step, setStep] = useState(0);
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [interest, setInterest] = useState(String(initial?.interestPercent ?? 2));
  const [termMin, setTermMin] = useState(String(initial?.termMin ?? 1));
  const [termMax, setTermMax] = useState(String(initial?.termMax ?? 1));
  const [termUnit, setTermUnit] = useState<"weeks" | "months">(initial?.termUnit ?? "weeks");
  const [minimum, setMinimum] = useState(initial ? centsToShillings(initial.minimumCents) : "1000");
  const [maximum, setMaximum] = useState(initial ? centsToShillings(initial.maximumCents) : "200000");
  const [guarantors, setGuarantors] = useState(String(initial?.minimumGuarantors ?? 0));
  const [coverage, setCoverage] = useState(String(initial?.coveragePercent ?? 0));
  const [fee, setFee] = useState(String(initial?.feePercent ?? 0));
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (step < PRODUCT_STEPS.length - 1) {
      advance();
      return;
    }
    setFormError(null);
    const minCents = shillingsToCents(minimum);
    const maxCents = shillingsToCents(maximum);
    if (minCents === null || maxCents === null) {
      setFormError("Enter whole shilling amounts for the range.");
      return;
    }
    const body: ProductInput = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      interestPercent: Number(interest),
      termMin: Number(termMin),
      termMax: Number(termMax),
      termUnit,
      minimumCents: minCents,
      maximumCents: maxCents,
      minimumGuarantors: Number(guarantors),
      coveragePercent: Number(coverage),
      feePercent: Number(fee),
    };
    setPending(true);
    try {
      if (editing) {
        const { code: _code, ...patch } = body;
        await adminApi.updateProduct(initial.code, patch);
      } else {
        await adminApi.createProduct(body);
      }
      onSaved();
    } catch (caught) {
      setFormError(caught instanceof AdminError ? caught.message : "That product did not save.");
    } finally {
      setPending(false);
    }
  }

  function advance(): void {
    setFormError(null);
    const id = PRODUCT_STEPS[step]?.id;
    if (id === "code" && code.trim().length === 0) {
      setFormError("Enter a code.");
      return;
    }
    if (id === "name" && name.trim().length === 0) {
      setFormError("Enter a name.");
      return;
    }
    if (id === "minimum" || id === "maximum") {
      const cents = shillingsToCents(id === "minimum" ? minimum : maximum);
      if (cents === null) {
        setFormError("Enter a whole shilling amount.");
        return;
      }
    }
    if (id === "maximum") {
      const minCents = shillingsToCents(minimum);
      const maxCents = shillingsToCents(maximum);
      if (minCents !== null && maxCents !== null && minCents > maxCents) {
        setFormError("The maximum has to be at least the minimum.");
        return;
      }
    }
    setStep((value) => value + 1);
  }

  const last = step === PRODUCT_STEPS.length - 1;

  return (
    <StepForm
      className="step-form-docked"
      steps={PRODUCT_STEPS}
      step={step}
      title={PRODUCT_STEPS[step]?.title}
      onBack={() => {
        setFormError(null);
        if (step === 0) onClose();
        else setStep((value) => value - 1);
      }}
      footer={
        last ? (
          <button className="primary" type="submit" form="product-flow" disabled={pending}>
            {pending ? "…" : editing ? "Save product" : "Add product"}
          </button>
        ) : (
          <button className="primary" type="button" onClick={advance}>
            Continue
          </button>
        )
      }
    >
      <form id="product-flow" onSubmit={(event) => void onSubmit(event)}>
        {step === 0 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            required
            maxLength={16}
            readOnly={editing}
            autoCapitalize="characters"
            spellCheck={false}
          />
        ) : null}
        {step === 1 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
          />
        ) : null}
        {step === 2 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            inputMode="numeric"
            value={interest}
            onChange={(event) => setInterest(event.target.value)}
            required
          />
        ) : null}
        {step === 3 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            inputMode="numeric"
            value={termMin}
            onChange={(event) => setTermMin(event.target.value)}
            required
          />
        ) : null}
        {step === 4 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            inputMode="numeric"
            value={termMax}
            onChange={(event) => setTermMax(event.target.value)}
            required
          />
        ) : null}
        {step === 5 ? (
          <Dropdown
            options={[
              { value: "weeks", label: "Weeks" },
              { value: "months", label: "Months" },
            ]}
            value={termUnit}
            listLabel="Term unit"
            onChange={(next) => setTermUnit(next === "months" ? "months" : "weeks")}
          />
        ) : null}
        {step === 6 ? <AmountField value={minimum} onChange={setMinimum} required aria-labelledby="step-title" /> : null}
        {step === 7 ? <AmountField value={maximum} onChange={setMaximum} required aria-labelledby="step-title" /> : null}
        {step === 8 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            inputMode="numeric"
            value={guarantors}
            onChange={(event) => setGuarantors(event.target.value)}
            required
          />
        ) : null}
        {step === 9 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            inputMode="numeric"
            value={coverage}
            onChange={(event) => setCoverage(event.target.value)}
            required
          />
        ) : null}
        {step === 10 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            inputMode="numeric"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            required
          />
        ) : null}
        {formError !== null ? (
          <p className="alert" role="alert">
            {formError}
          </p>
        ) : null}
      </form>
    </StepForm>
  );
}

const BUY_STEPS = [
  { id: "share", title: "Share" },
  { id: "units", title: "Units" },
  { id: "name", title: "Name" },
  { id: "confirm", title: "Confirm" },
] as const;

function InvestBuyFlow({ onClose, onBought }: { onClose: () => void; onBought: () => void }): React.ReactElement {
  const [step, setStep] = useState(0);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [units, setUnits] = useState(1);
  const [quote, setQuote] = useState<CloseQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shares, setShares] = useState<ListedShare[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .symbols()
      .then((payload) => {
        if (active) setShares(payload.symbols);
      })
      .catch((caught: unknown) => {
        if (active) setListError(caught instanceof AdminError ? caught.message : "Could not load the NSE list.");
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
      adminApi
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
          setQuoteError(caught instanceof AdminError ? caught.message : "Could not look up that close.");
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [symbol, nameTouched]);

  const unitCount = units;
  const costCents =
    quote !== null && Number.isFinite(unitCount) && unitCount > 0
      ? Math.round(unitCount * quote.closeCents)
      : null;

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (step < BUY_STEPS.length - 1) {
      advance();
      return;
    }
    setFormError(null);
    if (quote === null || !Number.isFinite(unitCount) || unitCount <= 0) {
      setFormError("Enter a ticker and how many shares. The close has to load first.");
      return;
    }
    setPending(true);
    try {
      await adminApi.buy({ symbol: quote.symbol, name: name.trim() || quote.name, units: unitCount });
      onBought();
    } catch (caught) {
      setFormError(caught instanceof AdminError ? caught.message : "The buy did not land.");
    } finally {
      setPending(false);
    }
  }

  function advance(): void {
    setFormError(null);
    if (step === 0 && symbol.trim().length === 0) {
      setFormError("Choose a share.");
      return;
    }
    if (step === 1 && (!Number.isFinite(unitCount) || unitCount <= 0)) {
      setFormError("Enter how many shares.");
      return;
    }
    if (step === 2 && name.trim().length === 0) {
      setFormError("Enter a name.");
      return;
    }
    setStep((value) => value + 1);
  }

  const last = step === BUY_STEPS.length - 1;

  return (
    <StepForm
      className="step-form-docked"
      steps={BUY_STEPS}
      step={step}
      onBack={() => {
        setFormError(null);
        if (step === 0) onClose();
        else setStep((value) => value - 1);
      }}
      footer={
        last ? (
          <button className="primary" type="submit" form="buy-flow" disabled={pending || quote === null}>
            {pending ? "…" : "Buy"}
          </button>
        ) : (
          <button className="primary" type="button" onClick={advance} disabled={step === 0 && shares === null}>
            Continue
          </button>
        )
      }
    >
      <form id="buy-flow" onSubmit={(event) => void onSubmit(event)}>
        {step === 0 ? (
          <Dropdown
            options={shares === null ? null : shares.map((share) => ({ value: share.symbol, label: share.name }))}
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
        ) : null}
        {step === 1 ? <QuantityField value={units} onChange={setUnits} labelledBy="step-title" /> : null}
        {step === 2 ? (
          <input
            className="step-control" aria-labelledby="step-title"
            value={name}
            onChange={(event) => {
              setNameTouched(true);
              setName(event.target.value);
            }}
            required
            maxLength={80}
          />
        ) : null}
        {step === 3 ? (
          <>
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
            {costCents !== null && quote !== null ? (
              <p className="meta">
                {formatUnits(unitCount)} shares for {formatKes(costCents)} at the {formatSession(quote.closeSession)} close.
              </p>
            ) : null}
          </>
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
      </form>
    </StepForm>
  );
}

function InvestDetailSheet({ id, onClose }: { id: string; onClose: () => void }): React.ReactElement {
  const [row, setRow] = useState<InvestmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .investment(id)
      .then((payload) => {
        if (active) setRow(payload.investment);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof AdminError ? caught.message : "Could not open this investment.");
      });
    return () => {
      active = false;
    };
  }, [id]);

  const boughtAt = row === null ? "" : formatNairobiDay(row.openedAt);
  const buyPrice = row?.marks[0]?.priceCents ?? row?.priceCents ?? 0;

  return (
    <Sheet title={row?.name ?? "Investment"} onClose={onClose}>
      {error !== null ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {row !== null ? (
        <div className="panel">
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
            Since the buy: {row.gainCents >= 0 ? "+" : "−"} {formatKes(Math.abs(row.gainCents))}.
          </p>
        </div>
      ) : error === null ? (
        <p className="meta">Loading…</p>
      ) : null}
    </Sheet>
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
          <BackLink to="/loans" label="Back to queue" />
          <h1 className="screen-title">Loan</h1>
        </header>
        {application === null && error === null ? <p className="meta">Loading.</p> : null}
        {application !== null ? (
          <StepForm steps={WORK_STEPS} step={step} {...(step > 0 ? { onBack: () => setStep((value) => value - 1) } : {})}>
            {step === 0 ? (
              <div className="panel">
                <p className="meta">{formatPersonName(application.memberName)}</p>
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
                    {formatPersonName(row.name)} · {formatKes(row.amountCents)} · {row.status}
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
