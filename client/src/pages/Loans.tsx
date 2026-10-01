import { useEffect, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { ApiError, api, type LoanApplication, type LoanMember, type LoanMine, type LoanProduct } from "../api";
import { AmountField } from "../components/AmountField";
import { BackLink } from "../components/BackLink";
import { Dropdown } from "../components/Dropdown";
import { KenyanPhoneField } from "../components/KenyanPhoneField";
import { MarkCheck, MarkPlus, MarkTrash } from "../components/marks";
import { Nav } from "../components/Nav";
import { StepForm } from "../flow/StepForm";
import { explainShillings, formatKes, formatShillingsTyping, shillingsToCents } from "../format";
import { isCompleteNational } from "../phone";
import { repaymentCents } from "../repayment";
import { useSession } from "../session";

const STEPS = [
  { id: "details", title: "Loan details" },
  { id: "guarantors", title: "Guarantors" },
  { id: "review", title: "Review" },
  { id: "desk", title: "Desk" },
] as const;

/** API still requires a purpose; the form no longer collects one. */
const DEFAULT_PURPOSE = "Personal";

const TERMINAL = new Set(["rejected", "cancelled", "disbursed"]);

type DraftGuarantee = { memberId: string; name: string; amountCents: number; freeCents: number };

function shillingsField(cents: number): string {
  return formatShillingsTyping(String(Math.trunc(cents / 100)));
}

function loanCap(
  label: string | null,
  cents: number,
  figureTone?: "match" | "miss",
  detail?: string,
): ReactElement {
  const figureClass =
    figureTone === "match"
      ? "loan-cap-figure loan-cap-figure-match"
      : figureTone === "miss"
        ? "loan-cap-figure loan-cap-figure-miss"
        : "loan-cap-figure";
  return (
    <span className="loan-cap">
      {label !== null ? <span className="loan-cap-label">{label}</span> : null}
      <span className={figureClass}>{formatKes(cents)}</span>
      {detail !== undefined ? <span className="loan-cap-detail">{detail}</span> : null}
      <span className="loan-cap-mark" aria-hidden="true" />
    </span>
  );
}

function loanCaps(loanCents: number, guaranteedCents: number): ReactElement {
  return (
    <span className="loan-caps">
      {loanCap("Loan amount", loanCents)}
      {loanCap("Guaranteed", guaranteedCents, guaranteedCents === loanCents ? "match" : "miss")}
    </span>
  );
}

/** Whole percent, or one or two decimals, from 0 up to 100. */
function parsePercent(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return value;
}

function percentToCents(loanCents: number, raw: string): number {
  const share = parsePercent(raw);
  if (share === null) return 0;
  return Math.round((loanCents * share) / 100);
}

function centsToPercent(loanCents: number, amountCents: number): string {
  if (loanCents <= 0) return "";
  return String(Number(((amountCents * 100) / loanCents).toFixed(2)));
}

function sanitizePercentInput(raw: string): string {
  const next = raw.replace(/[^\d.]/g, "");
  const [whole = "", fraction] = next.split(".");
  return fraction === undefined ? whole.slice(0, 3) : `${whole.slice(0, 3)}.${fraction.slice(0, 2)}`;
}

/** Whole shillings, or shillings and cents when the interest rounding leaves a fraction. */
function centsField(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = Math.abs(cents % 100);
  if (fraction === 0) return formatShillingsTyping(String(whole));
  return formatShillingsTyping(`${whole}.${String(fraction).padStart(2, "0")}`);
}

function capFor(product: LoanProduct | undefined, freeCents: number): number {
  if (product === undefined) return freeCents;
  return Math.min(freeCents, product.maximumCents);
}

function deskLine(application: LoanApplication): string {
  if (application.status === "awaiting_guarantors") {
    return "Waiting on guarantors. The desk starts once they have answered.";
  }
  if (application.status === "under_appraisal") return "The desk is appraising this loan.";
  if (application.status === "awaiting_approval") return "The desk has appraised it and is deciding.";
  if (application.status === "approved") {
    return application.loan?.status === "pending" ? "M-Pesa is sending the payout." : "Approved. The desk will pay it out.";
  }
  if (application.status === "disbursed") {
    const net = application.loan?.netCents;
    return net === undefined ? "Paid out. It did not go into your pot." : `Paid out ${formatKes(net)}. It did not go into your pot.`;
  }
  if (application.status === "rejected") return application.decisionNotes ?? "The desk did not approve this loan.";
  return "This loan is closed.";
}

export function Loans(): React.ReactElement {
  const { member } = useSession();
  const [mine, setMine] = useState<LoanMine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [composing, setComposing] = useState(false);
  const [productCode, setProductCode] = useState("");
  const [termCount, setTermCount] = useState(1);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [selfPercent, setSelfPercent] = useState("");
  const [others, setOthers] = useState<DraftGuarantee[]>([]);
  const [draftCents, setDraftCents] = useState(0);
  const [crew, setCrew] = useState<LoanMember[]>([]);
  const [pending, setPending] = useState(false);
  const [canAddGuarantor, setCanAddGuarantor] = useState(false);

  function load(): void {
    api
      .loans.mine()
      .then((payload) => {
        setMine(payload);
        setError(null);
        const first = payload.products[0];
        if (first !== undefined) setProductCode((current) => (current === "" ? first.code : current));
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : "Could not load loans.");
      });
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let active = true;
    api
      .loans.members("")
      .then((payload) => {
        if (active) setCrew(payload.members);
      })
      .catch(() => {
        if (active) setCrew([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const product = mine?.products.find((row) => row.code === productCode);
  const freeCents = mine?.capacity.freeCents ?? 0;
  const limit = capFor(product, freeCents);
  const amountCents = shillingsToCents(amount);
  const dueCents =
    product === undefined || amountCents === null ? null : repaymentCents(amountCents, product.interestPercent);
  const dueText = dueCents === null ? "" : centsField(dueCents);
  const othersSum = others.reduce((sum, row) => sum + row.amountCents, 0);
  const selfShare = amountCents === null ? 0 : percentToCents(amountCents, selfPercent);
  const guaranteedCents = selfShare + othersSum + draftCents;

  const application = mine?.application ?? null;
  const watching = application !== null && !TERMINAL.has(application.status) && !composing;
  const finished = application !== null && TERMINAL.has(application.status) && !composing;
  const shownStep = watching || finished ? 3 : step;

  const termChoices = useMemo(() => {
    if (product === undefined) return [];
    const values: number[] = [];
    for (let value = product.termMin; value <= product.termMax; value += 1) values.push(value);
    return values;
  }, [product]);

  useEffect(() => {
    const first = termChoices[0];
    if (first !== undefined && !termChoices.includes(termCount)) setTermCount(first);
  }, [termChoices, termCount]);

  useEffect(() => {
    if (amountCents === null) return;
    setOthers((rows) => {
      const next = rows.filter((row) => row.amountCents <= amountCents);
      return next.reduce((sum, row) => sum + row.amountCents, 0) + percentToCents(amountCents, selfPercent) > amountCents
        ? []
        : next;
    });
  }, [amountCents, selfPercent]);

  function amountProblem(): string | null {
    if (product === undefined) return "Choose a loan.";
    const typed = explainShillings(amount, { wholeOnly: true });
    if (typed !== null) return typed;
    if (amountCents === null) return "Enter an amount in KES, up to two decimals.";
    if (amountCents < product.minimumCents) return `The smallest ${product.name} is ${formatKes(product.minimumCents)}.`;
    if (amountCents > limit) return `You can borrow up to ${formatKes(limit)}.`;
    return null;
  }

  function guarantorRows(): { memberId: string; amountCents: number }[] {
    if (member === null || amountCents === null || selfShare <= 0) return [];
    return [{ memberId: member.id, amountCents: selfShare }, ...others.map((row) => ({ memberId: row.memberId, amountCents: row.amountCents }))];
  }

  function guarantorProblem(): string | null {
    if (product === undefined || amountCents === null) return "Choose a loan.";
    if (parsePercent(selfPercent) === null) return "Enter your guarantee percentage.";
    if (selfShare <= 0) return "Enter your guarantee percentage.";
    if (selfShare > freeCents) return `You can guarantee up to ${formatKes(freeCents)}.`;
    if (selfShare + othersSum > amountCents) return "Guarantees are more than the loan.";
    const people = 1 + others.length;
    if (people < product.minimumGuarantors) return `This loan needs ${product.minimumGuarantors} guarantors.`;
    if (selfShare + othersSum !== amountCents) return "Guarantees have to add up to the loan.";
    return null;
  }

  async function submit(): Promise<void> {
    if (product === undefined || amountCents === null) return;
    setPending(true);
    setError(null);
    try {
      await api.loans.apply({
        productCode: product.code,
        amountCents,
        termCount,
        purpose: DEFAULT_PURPOSE,
        phone,
        guarantors: guarantorRows(),
      });
      setComposing(false);
      setStep(0);
      setSelfPercent("");
      setOthers([]);
      setDraftCents(0);
      setAmount("");
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The application did not go in.");
    } finally {
      setPending(false);
    }
  }

  async function inviteMore(memberId: string, amountCentsValue: number): Promise<void> {
    if (application === null) return;
    setPending(true);
    setError(null);
    try {
      await api.loans.invite(application.id, { memberId, amountCents: amountCentsValue });
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That request did not go out.");
    } finally {
      setPending(false);
    }
  }

  async function answer(id: string, accept: boolean): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const next = await api.loans.respond(id, accept);
      setMine(next);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That answer did not land.");
    } finally {
      setPending(false);
    }
  }

  const detailsOk = amountProblem() === null && isCompleteNational(phone);
  const guaranteesOk = guarantorProblem() === null;

  return (
    <>
      <main className="screen" id="main">
        {(watching || finished) && application !== null ? (
          <header className="screen-head">
            <BackLink to="/" label="Back to Pot" />
            <h1 className="screen-title">Loans</h1>
            <button className="icon-btn" type="button" onClick={() => setComposing(true)} aria-label="New loan">
              <MarkPlus />
            </button>
          </header>
        ) : null}
        {mine === null && error === null ? <p className="meta">Loading loans.</p> : null}
        {mine !== null && mine.incoming.length > 0 ? (
          <section className="panel" aria-label="Guarantee requests">
            <h2 className="screen-title">Asked of you</h2>
            {mine.incoming.map((row) => (
              <div key={row.id} className="loan-line">
                <p className="meta">
                  {row.borrowerName} · {row.productName} · {formatKes(row.amountCents)}
                </p>
                <span className="loan-actions">
                  <button className="ghost" type="button" disabled={pending} onClick={() => void answer(row.id, false)}>
                    Decline
                  </button>
                  <button className="primary" type="button" disabled={pending} onClick={() => void answer(row.id, true)}>
                    Guarantee
                  </button>
                </span>
              </div>
            ))}
          </section>
        ) : null}
        {(watching || finished) && application !== null ? (
          <DeskView
            application={application}
            crew={crew}
            pending={pending}
            onInvite={(memberId, cents) => void inviteMore(memberId, cents)}
          />
        ) : null}
        {mine !== null && !watching && !finished ? (
          <StepForm
            steps={STEPS}
            step={shownStep}
            {...(shownStep <= 2 ? { className: "step-form-docked" } : {})}
            title={
              shownStep === 0
                ? loanCap("Up to", limit)
                : shownStep === 1 && amountCents !== null
                  ? loanCaps(amountCents, guaranteedCents)
                  : shownStep === 2 && amountCents !== null && product !== undefined
                    ? loanCap(null, amountCents, undefined, product.name)
                    : undefined
            }
            {...(shownStep > 0 ? { onBack: () => setStep((value) => value - 1) } : {})}
            footer={
              shownStep === 0 ? (
                <button className="primary" type="button" disabled={!detailsOk} onClick={() => setStep(1)}>
                  Continue
                </button>
              ) : shownStep === 1 ? (
                <>
                  <button className="guarantor-new" type="submit" form="guarantor-picker" disabled={!canAddGuarantor}>
                    New guarantor
                  </button>
                  <button className="primary" type="button" disabled={!guaranteesOk} onClick={() => setStep(2)}>
                    Review
                  </button>
                </>
              ) : shownStep === 2 ? (
                <button className="primary" type="button" disabled={pending || !detailsOk || !guaranteesOk} onClick={() => void submit()}>
                  {pending ? "…" : "Submit Application"}
                </button>
              ) : null
            }
          >
            {shownStep === 0 ? (
              <form className="panel loan-details">
                <label className="field">
                  Loan type
                  <select
                    value={productCode}
                    onChange={(event) => setProductCode(event.target.value)}
                    required
                  >
                    {mine.products.map((row) => (
                      <option key={row.code} value={row.code}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                {termChoices.length > 1 ? (
                  <label className="field">
                    Term
                    <select value={String(termCount)} onChange={(event) => setTermCount(Number(event.target.value))}>
                      {termChoices.map((value) => (
                        <option key={value} value={value}>
                          {value} {product?.termUnit ?? "months"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <AmountField label="Amount" value={amount} onChange={setAmount} required />
                <AmountField label="Repayment amount" value={dueText} onChange={() => undefined} readOnly />
                <KenyanPhoneField value={phone} onChange={setPhone} />
                {amountProblem() !== null && amount.length > 0 ? (
                  <p className="alert" role="alert">
                    {amountProblem()}
                  </p>
                ) : null}
              </form>
            ) : null}
            {shownStep === 1 && amountCents !== null && member !== null ? (
              <GuarantorPicker
                loanCents={amountCents}
                selfName={member.name}
                selfFree={freeCents}
                selfPercent={selfPercent}
                selfShare={selfShare}
                others={others}
                crew={crew}
                minimumGuarantors={product?.minimumGuarantors ?? 0}
                onSelfPercentChange={setSelfPercent}
                onDraftCentsChange={setDraftCents}
                onCanAddChange={setCanAddGuarantor}
                onAdd={(row) => setOthers((rows) => [...rows, row])}
                onUpdate={(memberId, amountCents) =>
                  setOthers((rows) => rows.map((row) => (row.memberId === memberId ? { ...row, amountCents } : row)))
                }
                onRemove={(memberId) => setOthers((rows) => rows.filter((row) => row.memberId !== memberId))}
                problem={guarantorProblem()}
              />
            ) : null}
            {shownStep === 2 && product !== undefined && amountCents !== null ? (
              <div className="panel loan-review">
                <dl className="loan-review-facts">
                  <div className="loan-review-fact">
                    <dt>Repay</dt>
                    <dd>{dueCents === null ? "—" : formatKes(dueCents)}</dd>
                  </div>
                  <div className="loan-review-fact">
                    <dt>Guarantors</dt>
                    <dd>{1 + others.length}</dd>
                  </div>
                </dl>
                <div className="loan-review-people" aria-label="Guarantors">
                  <p className="loan-review-people-label">Guarantors</p>
                  <div className="loan-review-person">
                    <span className="guarantor-who">You</span>
                    <span className="guarantor-amt">{formatKes(selfShare)}</span>
                    <span className="guarantor-limit">{selfPercent.trim() === "" ? "" : `${selfPercent}%`}</span>
                  </div>
                  {others.map((row) => (
                    <div key={row.memberId} className="loan-review-person">
                      <span className="guarantor-who">{row.name}</span>
                      <span className="guarantor-amt">{formatKes(row.amountCents)}</span>
                      <span className="guarantor-limit">{centsToPercent(amountCents, row.amountCents)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </StepForm>
        ) : null}
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
      </main>
      <Nav />
    </>
  );
}

function GuarantorPicker({
  loanCents,
  selfName,
  selfFree,
  selfPercent,
  selfShare,
  others,
  crew,
  minimumGuarantors,
  onSelfPercentChange,
  onDraftCentsChange,
  onCanAddChange,
  onAdd,
  onUpdate,
  onRemove,
  problem,
}: {
  loanCents: number;
  selfName: string;
  selfFree: number;
  selfPercent: string;
  selfShare: number;
  others: readonly DraftGuarantee[];
  crew: readonly LoanMember[];
  minimumGuarantors: number;
  onSelfPercentChange: (value: string) => void;
  onDraftCentsChange: (cents: number) => void;
  onCanAddChange: (ready: boolean) => void;
  onAdd: (row: DraftGuarantee) => void;
  onUpdate: (memberId: string, amountCents: number) => void;
  onRemove: (memberId: string) => void;
  problem: string | null;
}): React.ReactElement {
  const [adding, setAdding] = useState(false);
  const [pickedId, setPickedId] = useState("");
  const [percent, setPercent] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<"self" | "new" | string | null>(() =>
    selfPercent.trim() === "" ? "self" : null,
  );
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({});
  const picked = crew.find((row) => row.id === pickedId) ?? null;
  const othersSum = others.reduce((sum, row) => sum + row.amountCents, 0);
  const room = Math.max(loanCents - selfShare - othersSum, 0);
  const draftCents = percentToCents(loanCents, percent);
  const selfReady = parsePercent(selfPercent) !== null && selfShare > 0;
  const draftReady = picked !== null && parsePercent(percent) !== null && draftCents > 0;
  const options = crew
    .filter((row) => !others.some((item) => item.memberId === row.id))
    .map((row) => ({ value: row.id, label: row.name, hint: `${formatKes(row.freeCents)} free` }));

  useEffect(() => {
    onDraftCentsChange(adding ? draftCents : 0);
  }, [adding, draftCents, onDraftCentsChange]);

  useEffect(() => {
    return () => onDraftCentsChange(0);
  }, [onDraftCentsChange]);

  const canSubmit = !adding ? selfReady : draftReady;

  useEffect(() => {
    onCanAddChange(canSubmit);
  }, [canSubmit, onCanAddChange]);

  useEffect(() => {
    return () => onCanAddChange(false);
  }, [onCanAddChange]);

  useEffect(() => {
    setOtherDrafts((drafts) => {
      const next: Record<string, string> = {};
      for (const row of others) {
        const typed = drafts[row.memberId];
        next[row.memberId] =
          editingKey === row.memberId && typed !== undefined
            ? typed
            : centsToPercent(loanCents, row.amountCents);
      }
      return next;
    });
  }, [others, loanCents, editingKey]);

  function validateSelf(): string | null {
    if (!selfReady) return "Enter your guarantee percentage first.";
    if (selfShare > selfFree) return `You can guarantee up to ${formatKes(selfFree)}.`;
    return null;
  }

  function commitDraft(): string | null {
    if (picked === null) return "Choose a member.";
    const share = parsePercent(percent);
    if (share === null) return "Enter a percentage from 1 to 100.";
    const cents = Math.round((loanCents * share) / 100);
    if (cents <= 0) return "Enter a percentage from 1 to 100.";
    if (cents > picked.freeCents) return `${picked.name} can guarantee up to ${formatKes(picked.freeCents)}.`;
    if (cents > room) return `That leaves the cover above the loan. Up to ${formatKes(room)} still open.`;
    onAdd({ memberId: picked.id, name: picked.name, amountCents: cents, freeCents: picked.freeCents });
    setPickedId("");
    setPercent("");
    setAdding(false);
    setEditingKey(null);
    return null;
  }

  function saveSelf(): void {
    const issue = validateSelf();
    if (issue !== null) {
      setLocalError(issue);
      return;
    }
    setLocalError(null);
    setEditingKey(null);
  }

  function saveOther(memberId: string): void {
    const row = others.find((item) => item.memberId === memberId);
    if (row === undefined) return;
    const draft = otherDrafts[memberId] ?? centsToPercent(loanCents, row.amountCents);
    const share = parsePercent(draft);
    if (share === null) {
      setLocalError("Enter a percentage from 1 to 100.");
      return;
    }
    const cents = Math.round((loanCents * share) / 100);
    if (cents <= 0) {
      setLocalError("Enter a percentage from 1 to 100.");
      return;
    }
    if (cents > row.freeCents) {
      setLocalError(`${row.name} can guarantee up to ${formatKes(row.freeCents)}.`);
      return;
    }
    const roomWithout = Math.max(loanCents - selfShare - (othersSum - row.amountCents), 0);
    if (cents > roomWithout) {
      setLocalError(`That leaves the cover above the loan. Up to ${formatKes(roomWithout)} still open.`);
      return;
    }
    setLocalError(null);
    onUpdate(memberId, cents);
    setEditingKey(null);
  }

  function saveNew(): void {
    const selfIssue = validateSelf();
    if (selfIssue !== null) {
      setLocalError(selfIssue);
      return;
    }
    const issue = commitDraft();
    if (issue !== null) setLocalError(issue);
    else setLocalError(null);
  }

  function add(event: FormEvent): void {
    event.preventDefault();
    setLocalError(null);
    const selfIssue = validateSelf();
    if (selfIssue !== null) {
      setLocalError(selfIssue);
      return;
    }
    if (!adding) {
      setAdding(true);
      setEditingKey("new");
      return;
    }
    const issue = commitDraft();
    if (issue !== null) setLocalError(issue);
  }

  return (
    <form id="guarantor-picker" className="panel" onSubmit={add}>
      {problem !== null && localError === null ? <p className="meta">{problem}</p> : null}
      <GuarantorEntry
        who={
          <div className="guarantor-locked" aria-label={selfName}>
            {selfName}
          </div>
        }
        percent={selfPercent}
        percentLabel="Your percentage"
        editing={editingKey === "self"}
        onPercentFocus={() => setEditingKey("self")}
        onPercentChange={(value) => {
          onSelfPercentChange(value);
          setEditingKey("self");
          setLocalError(null);
        }}
        onSave={saveSelf}
      />
      {others.map((row) => {
        const draft = otherDrafts[row.memberId] ?? centsToPercent(loanCents, row.amountCents);
        return (
          <GuarantorEntry
            key={row.memberId}
            who={<div className="guarantor-locked">{row.name}</div>}
            percent={draft}
            percentLabel={`${row.name} percentage`}
            editing={editingKey === row.memberId}
            onPercentFocus={() => setEditingKey(row.memberId)}
            onPercentChange={(value) => {
              setOtherDrafts((prev) => ({ ...prev, [row.memberId]: value }));
              setEditingKey(row.memberId);
              setLocalError(null);
            }}
            onSave={() => saveOther(row.memberId)}
            onRemove={() => onRemove(row.memberId)}
          />
        );
      })}
      {adding ? (
        <GuarantorEntry
          who={
            <Dropdown
              options={options}
              value={pickedId}
              listLabel="Guarantor"
              placeholder="choose..."
              onChange={(next) => {
                setPickedId(next);
                setEditingKey("new");
                setLocalError(null);
              }}
            />
          }
          percent={percent}
          percentLabel="Percentage"
          editing={editingKey === "new"}
          onPercentFocus={() => setEditingKey("new")}
          onPercentChange={(value) => {
            setPercent(value);
            setEditingKey("new");
            setLocalError(null);
          }}
          onSave={saveNew}
        />
      ) : null}
      {minimumGuarantors > 1 && 1 + others.length < minimumGuarantors ? (
        <p className="meta">This loan needs {minimumGuarantors} guarantors.</p>
      ) : null}
      {localError !== null ? (
        <p className="alert" role="alert">
          {localError}
        </p>
      ) : null}
    </form>
  );
}

function GuarantorEntry({
  who,
  percent,
  percentLabel,
  editing,
  onPercentFocus,
  onPercentChange,
  onSave,
  onRemove,
}: {
  who: ReactNode;
  percent: string;
  percentLabel: string;
  editing: boolean;
  onPercentFocus: () => void;
  onPercentChange: (value: string) => void;
  onSave: () => void;
  onRemove?: () => void;
}): ReactElement {
  return (
    <div className="guarantor-entry">
      <div className="guarantor-entry-main">
        <div className="field guarantor-pick">{who}</div>
        <label className="field guarantor-percent">
          <span className="visually-hidden">{percentLabel}</span>
          <span className="percent-field">
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label={percentLabel}
              value={percent}
              onFocus={onPercentFocus}
              onChange={(event) => onPercentChange(sanitizePercentInput(event.target.value))}
            />
            <span className="percent-suffix" aria-hidden="true">
              %
            </span>
          </span>
        </label>
      </div>
      <div className="guarantor-entry-action">
        {editing ? (
          <button type="button" className="amount-save guarantor-action-btn" aria-label="Save" onClick={onSave}>
            <MarkCheck />
          </button>
        ) : onRemove !== undefined ? (
          <button
            type="button"
            className="guarantor-remove guarantor-action-btn"
            aria-label="Remove guarantor"
            onClick={onRemove}
          >
            <MarkTrash />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DeskView({
  application,
  crew,
  pending,
  onInvite,
}: {
  application: LoanApplication;
  crew: readonly LoanMember[];
  pending: boolean;
  onInvite: (memberId: string, amountCents: number) => void;
}): React.ReactElement {
  const held = application.guarantors
    .filter((row) => row.status === "accepted" || row.status === "invited")
    .reduce((sum, row) => sum + row.amountCents, 0);
  const gap = Math.max(application.amountCents - held, 0);
  const taken = new Set(application.guarantors.filter((row) => row.status === "accepted" || row.status === "invited").map((row) => row.memberId));
  const [pickedId, setPickedId] = useState("");
  const [pledge, setPledge] = useState("");
  const picked = crew.find((row) => row.id === pickedId) ?? null;

  return (
    <article className="loan-record">
      <p className="meta">{application.productName}</p>
      <p className="money">{formatKes(application.amountCents)}</p>
      <p className="meta">{deskLine(application)}</p>
      {application.guarantors.length > 0 ? (
        <div className="loan-record-people">
          {application.guarantors.map((row) => (
            <div key={row.id} className="loan-record-person">
              <span className="guarantor-who">{row.name}</span>
              <span className="guarantor-amt">{formatKes(row.amountCents)}</span>
              <span className="guarantor-limit">{row.status}</span>
            </div>
          ))}
        </div>
      ) : null}
      {application.appraisalNotes !== null ? <p className="meta">{application.appraisalNotes}</p> : null}
      {application.status === "awaiting_guarantors" && gap > 0 ? (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            const cents = shillingsToCents(pledge);
            if (picked === null || cents === null || explainShillings(pledge, { wholeOnly: true }) !== null) return;
            onInvite(picked.id, cents);
            setPickedId("");
            setPledge("");
          }}
        >
          <p className="meta">{formatKes(gap)} still needs a guarantor.</p>
          <div className="field">
            <span>Member</span>
            <Dropdown
              options={crew
                .filter((row) => !taken.has(row.id))
                .map((row) => ({ value: row.id, label: row.name, hint: `${formatKes(row.freeCents)} free` }))}
              value={pickedId}
              listLabel="Members"
              onChange={(next) => {
                const person = crew.find((row) => row.id === next);
                setPickedId(next);
                if (person === undefined) return;
                setPledge(shillingsField(Math.min(person.freeCents, gap)));
              }}
            />
          </div>
          {picked !== null ? (
            <p className="meta">
              {picked.name} can guarantee up to {formatKes(picked.freeCents)}.
            </p>
          ) : null}
          <AmountField label="Their share" value={pledge} onChange={setPledge} />
          <button className="primary" type="submit" disabled={pending || picked === null}>
            Ask
          </button>
        </form>
      ) : null}
    </article>
  );
}
