import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { animated, useSpring } from "@react-spring/web";
import { ApiError, api, type Member } from "../api";
import { AmountField } from "../components/AmountField";
import { BackLink } from "../components/BackLink";
import { Dropdown } from "../components/Dropdown";
import { KenyanPhoneField } from "../components/KenyanPhoneField";
import { MarkBook } from "../components/marks";
import { Nav } from "../components/Nav";
import { Pot, StaticAmount } from "../components/Pot";
import { StepForm, type FlowStep } from "../flow/StepForm";
import { waitForPayment } from "../flow/waitForPayment";
import { MAX_MPESA_CENTS, explainShillings, formatKes, shillingsToCents } from "../format";
import { readGoalShillings, shareTowardGoal } from "../goal";
import { useReducedMotion } from "../motion";
import { displayMsisdn, isCompleteNational } from "../phone";

type Mode = "deposit" | "withdraw" | "send";

const STEPS: Record<Mode, readonly FlowStep[]> = {
  deposit: [
    { id: "amount", title: "How much?" },
    { id: "phone", title: "Pay with M-Pesa" },
    { id: "wait", title: "Approve on your phone" },
    { id: "receipt", title: "Receipt" },
  ],
  withdraw: [
    { id: "amount", title: "How much?" },
    { id: "phone", title: "Receive on M-Pesa" },
    { id: "wait", title: "Approve on your phone" },
    { id: "receipt", title: "Receipt" },
  ],
  send: [
    { id: "amount", title: "How much?" },
    { id: "confirm", title: "Confirm send" },
    { id: "receipt", title: "Receipt" },
  ],
};

function newAttempt(): string {
  return crypto.randomUUID();
}

export function Move(): React.ReactElement {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("deposit");
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState("");
  const [toMemberId, setToMemberId] = useState("");
  const [phone, setPhone] = useState("");
  const [attempt, setAttempt] = useState(newAttempt);
  const [members, setMembers] = useState<Member[]>([]);
  const [claim, setClaim] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.members(), api.me(), api.home()])
      .then(([crew, me, home]) => {
        if (!active) return;
        setMembers(crew.members.filter((member) => member.id !== me.member.id));
        setClaim(home.you.claimCents);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not load members.");
      });
    return () => {
      active = false;
    };
  }, []);

  const verb = mode === "deposit" ? "Add" : mode === "withdraw" ? "Out" : "Send";
  const modes = [
    ["deposit", "Add"],
    ["withdraw", "Out"],
    ["send", "Send"],
  ] as const;
  const modeIndex = modes.findIndex(([key]) => key === mode);
  const reduced = useReducedMotion();
  const pill = useSpring({
    x: modeIndex < 0 ? 0 : modeIndex,
    immediate: reduced,
    config: { tension: 320, friction: 28 },
  });
  const shillings = claim === null ? 0 : claim / 100;
  const digits = String(Math.round(shillings)).length;
  const goalShillings = readGoalShillings();
  const towardGoal = claim === null ? null : shareTowardGoal(claim, goalShillings);
  const fillShare = towardGoal ?? 0;
  const percent = Math.round(fillShare * 100);
  const steps = STEPS[mode];
  const cents = shillingsToCents(amount);
  const recipient = members.find((member) => member.id === toMemberId) ?? null;
  const needsPhone = mode !== "send";
  const phoneReady = !needsPhone || isCompleteNational(phone);

  function changeMode(next: Mode): void {
    if (waiting) return;
    setMode(next);
    setStep(0);
    setError(null);
    setAttempt(newAttempt());
  }

  function goBack(): void {
    if (waiting) return;
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }

  function amountProblem(): string | null {
    const mpesa = mode === "deposit" || mode === "withdraw";
    return explainShillings(amount, {
      ...(mpesa ? { maxCents: MAX_MPESA_CENTS, wholeOnly: true } : {}),
    });
  }

  function onAmount(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    const problem = amountProblem();
    if (problem !== null) {
      setError(problem);
      return;
    }
    if (mode === "send" && toMemberId.length === 0) {
      setError("Choose who receives it.");
      return;
    }
    setAttempt(newAttempt());
    setStep(1);
  }

  async function onPay(event: FormEvent): Promise<void> {
    event.preventDefault();
    const problem = amountProblem();
    if (problem !== null || cents === null) {
      setError(problem ?? "Enter an amount in KES, up to two decimals.");
      return;
    }
    if (!phoneReady) {
      setError("Enter the nine digits after +254.");
      return;
    }
    if (mode === "send" && toMemberId.length === 0) {
      setError("Choose who receives it.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const started = await api.startPayment({
        kind: mode === "send" ? "transfer" : mode,
        amountCents: cents,
        idempotencyKey: attempt,
        ...(needsPhone ? { phone: `254${phone}` } : {}),
        ...(mode === "send" ? { toMemberId } : {}),
      });
      if (started.status === "succeeded") {
        void navigate(`/receipts/${started.id}`);
        return;
      }
      if (started.status === "failed") {
        setError("M-Pesa did not accept that request. Try again.");
        setAttempt(newAttempt());
        return;
      }
      setWaiting(true);
      setStep(2);
      const settled = await waitForPayment(started.id);
      setWaiting(false);
      if (settled.status === "succeeded") {
        void navigate(`/receipts/${settled.id}`);
        return;
      }
      setStep(1);
      setAttempt(newAttempt());
      setError("M-Pesa did not complete. Check your phone and try again.");
    } catch (caught) {
      setWaiting(false);
      setStep(1);
      setAttempt(newAttempt());
      setError(caught instanceof ApiError ? caught.message : "That did not go through.");
    } finally {
      setPending(false);
    }
  }

  const amountForm = (
    <form className="panel" onSubmit={onAmount}>
      <div className="modes" role="group" aria-label="Movement">
        <animated.span
          className="mode-pill"
          aria-hidden="true"
          style={{ transform: pill.x.to((value) => `translateX(${value * 100}%)`) }}
        />
        {modes.map(([key, label]) => (
          <button key={key} type="button" className="mode" aria-pressed={mode === key} onClick={() => changeMode(key)}>
            <span className="mode-name">{label}</span>
          </button>
        ))}
      </div>
      <AmountField label="Amount" value={amount} onChange={setAmount} required className="field" />
      {mode === "send" ? (
        <div className="field">
          <span id="send-to-label">To</span>
          <Dropdown
            options={members.map((member) => ({ value: member.id, label: member.name }))}
            value={toMemberId}
            listLabel="Crew"
            onChange={setToMemberId}
          />
        </div>
      ) : null}
      {error !== null ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <button className="primary" type="submit">
        {verb}
      </button>
    </form>
  );

  return (
    <>
      <main className={step === 0 ? "screen screen-move" : "screen"} id="main">
        {step === 0 ? (
          <>
            <header className="screen-head">
              <BackLink to="/" label="Back to Pot" />
              <h1 className="screen-title">Move</h1>
              <Link className="pot-chain" to="/ledger" aria-label="Ledger">
                <MarkBook />
              </Link>
            </header>
            <div
              className="pot-band"
              aria-label={
                claim === null
                  ? "Your claim"
                  : goalShillings === null
                    ? `You can move ${formatKes(claim)}. Set a goal on Pot to fill the bowl.`
                    : `You can move ${formatKes(claim)}. ${percent}% of your goal.`
              }
            >
              <Pot animate={false} share={fillShare}>
                {claim !== null ? (
                  <p className="claim-amount" style={{ ["--digits" as string]: String(digits) }}>
                    <span className="claim-currency">KES</span>
                    <StaticAmount value={shillings} />
                  </p>
                ) : null}
              </Pot>
            </div>
            {amountForm}
          </>
        ) : (
          <StepForm
            steps={steps}
            step={step}
            {...(waiting ? {} : { onBack: goBack })}
            {...(step === 1
              ? {
                  footer: (
                    <button type="submit" form="move-pay" className="primary" disabled={!phoneReady || pending || waiting}>
                      {mode === "send" ? "Confirm" : waiting ? "Waiting for M-Pesa…" : "Receive Prompt"}
                    </button>
                  ),
                }
              : {})}
          >
            <form id="move-pay" onSubmit={(event) => void onPay(event)}>
              <p className="pick-summary">
                {verb}
                {recipient !== null ? ` to ${recipient.name}` : ""} · {cents === null ? amount : formatKes(cents)}
              </p>
              {needsPhone ? <KenyanPhoneField value={phone} onChange={setPhone} disabled={waiting} /> : null}
              {waiting ? (
                <p className="status" role="status">
                  {mode === "withdraw"
                    ? `M-Pesa is sending ${cents === null ? "the amount" : formatKes(cents)} to ${displayMsisdn(phone)}.`
                    : `Approve the M-Pesa prompt on ${displayMsisdn(phone)}. This page waits for Daraja to confirm.`}
                </p>
              ) : null}
              {error !== null ? (
                <p className="alert" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
          </StepForm>
        )}
      </main>
      <Nav />
    </>
  );
}
