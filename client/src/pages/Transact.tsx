import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api, type Member } from "../api";
import { AmountField } from "../components/AmountField";
import { Dropdown } from "../components/Dropdown";
import { KenyanPhoneField } from "../components/KenyanPhoneField";
import { ModeSwitch } from "../components/ModeSwitch";
import { Nav } from "../components/Nav";
import { Pot, StaticAmount } from "../components/Pot";
import { StepForm, type FlowStep } from "../flow/StepForm";
import { waitForPayment } from "../flow/waitForPayment";
import { MAX_MPESA_CENTS, explainShillings, formatKes, formatPersonName, shillingsToCents } from "../format";
import { readGoalShillings, shareTowardGoal } from "../goal";
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
    { id: "wait", title: "Waiting for admin" },
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

export function Transact(): React.ReactElement {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
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
  const amountRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const focusAmount = params.get("focus") === "amount";

  useEffect(() => {
    let active = true;
    Promise.all([api.members(), api.me(), api.home()])
      .then(([group, me, home]) => {
        if (!active) return;
        setMembers(group.members.filter((member) => member.id !== me.member.id));
        setClaim(home.you.claimCents);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not load members.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (step !== 0) return;
    if (focusAmount) setMode("deposit");
    const field = amountRef.current;
    if (field !== null) {
      field.focus();
      const end = field.value.length;
      field.setSelectionRange(end, end);
    }
    if (!focusAmount) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("focus");
        return next;
      },
      { replace: true },
    );
  }, [focusAmount, setParams, step]);

  const verb = mode === "deposit" ? "Deposit" : mode === "withdraw" ? "Draw" : "Send";
  const modes = [
    ["deposit", "Deposit"],
    ["withdraw", "Draw"],
    ["send", "Send"],
  ] as const;
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
      if (started.awaitingApproval) {
        void navigate(`/receipts/${started.id}`);
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
      <ModeSwitch label="Transact" value={mode} options={modes} onChange={changeMode} />
      <AmountField
        label="Amount"
        value={amount}
        onChange={setAmount}
        required
        placeholder=""
        className="field"
        inputRef={amountRef}
      />
      {mode === "send" ? (
        <div className="field">
          <span id="send-to-label">To</span>
          <Dropdown
            options={members.map((member) => ({ value: member.id, label: formatPersonName(member.name) }))}
            value={toMemberId}
            listLabel="Group"
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
      <main className={step === 0 ? "screen screen-transact" : "screen"} id="main">
        {step === 0 ? (
          <>
            <header className="screen-head">
              <h1 className="screen-title">Transact</h1>
            </header>
            {amountForm}
            {mode !== "send" ? (
              <div
                className="pot-band"
                aria-label={
                  claim === null
                    ? "Your claim"
                    : goalShillings === null
                      ? `Your claim is ${formatKes(claim)}. Set a goal on Pot to fill the bowl.`
                      : `Your claim is ${formatKes(claim)}. ${percent}% of your goal.`
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
            ) : null}
          </>
        ) : (
          <StepForm
            steps={steps}
            step={step}
            {...(step === 1
              ? {
                  className: "step-form-docked",
                  footer: (
                    <button type="submit" form="transact-pay" className="primary" disabled={!phoneReady || pending || waiting}>
                      {mode === "send"
                        ? "Confirm"
                        : waiting
                          ? "Waiting for M-Pesa…"
                          : mode === "withdraw"
                            ? "Request draw"
                            : "Receive Prompt"}
                    </button>
                  ),
                }
              : {})}
          >
            <form id="transact-pay" onSubmit={(event) => void onPay(event)}>
              <p className="pick-summary">
                {verb}
                {recipient !== null ? ` to ${formatPersonName(recipient.name)}` : ""} ·{" "}
                {cents === null ? amount : formatKes(cents)}
              </p>
              {needsPhone ? <KenyanPhoneField value={phone} onChange={setPhone} disabled={waiting} /> : null}
              {mode === "withdraw" && !waiting ? (
                <p className="hint">An admin has to approve this draw before M-Pesa sends the money.</p>
              ) : null}
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
