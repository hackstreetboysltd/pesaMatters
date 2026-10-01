import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, api, type HomePayload } from "../api";
import { AmountField } from "../components/AmountField";
import { MarkBook, MarkCheck } from "../components/marks";
import { Nav } from "../components/Nav";
import { Pot, StaticAmount } from "../components/Pot";
import { formatKesShillings, formatShillingsTyping } from "../format";
import { normalizeGoalShillings, readGoalShillings, shareTowardGoal, writeGoalShillings } from "../goal";
import { recordNotice } from "../notices";
import { useSession } from "../session";

export function Home(): React.ReactElement {
  const { member } = useSession();
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goalShillings, setGoalShillings] = useState<string | null>(() => readGoalShillings());
  const [editingGoal, setEditingGoal] = useState(() => readGoalShillings() === null);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);
  const goalFieldRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    api
      .home()
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not load the pot.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!editingGoal || goalFieldRef.current === null) return;
    const field = goalFieldRef.current;
    field.focus();
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }, [editingGoal]);

  const claimCents = data?.you.claimCents ?? 0;
  const towardGoal = shareTowardGoal(claimCents, goalShillings);
  const fillShare = towardGoal ?? 0;
  const percent = Math.round(fillShare * 100);
  const shillings = claimCents / 100;
  const digits = String(Math.round(shillings)).length;

  function onSetGoal(event: FormEvent): void {
    event.preventDefault();
    setGoalError(null);
    const normalized = normalizeGoalShillings(goalDraft);
    if (normalized === null) {
      setGoalError("Enter a goal in KES, up to two decimals.");
      return;
    }
    writeGoalShillings(normalized);
    setGoalShillings(normalized);
    setEditingGoal(false);
    setGoalDraft("");
    if (member !== null) {
      recordNotice(
        member.id,
        {
          id: `goal:${crypto.randomUUID()}`,
          at: new Date().toISOString(),
          text: `Successfully set goal to ${formatKesShillings(normalized)}`,
        },
        localStorage,
      );
    }
  }

  function startEditGoal(): void {
    if (goalShillings === null) {
      setEditingGoal(true);
      setGoalDraft("");
      return;
    }
    setGoalDraft(formatShillingsTyping(goalShillings));
    setGoalError(null);
    setEditingGoal(true);
  }

  const bandLabel =
    data === null
      ? "Your balance"
      : goalShillings === null
        ? "Set a goal to fill the pot"
        : `${percent}% of your goal`;

  return (
    <main className="home" id="main">
      <header className="topbar">
        <Link className="pot-chain" to="/ledger" aria-label="Ledger">
          <MarkBook />
        </Link>
      </header>
      <section className="pot-band" aria-label={bandLabel}>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : data === null ? (
          <Pot animate={false} share={0} />
        ) : (
          <div className="pot-stack">
            <div className="goal">
              <p className="goal-label" id="goal-label">
                My Goal
              </p>
              {editingGoal ? (
                <form className="goal-form" onSubmit={onSetGoal}>
                  <AmountField
                    value={goalDraft}
                    onChange={setGoalDraft}
                    required
                    autoGrow
                    enterSubmits
                    inputRef={goalFieldRef}
                    aria-labelledby="goal-label"
                    accessory={
                      <button type="submit" className="amount-save" aria-label="Save goal">
                        <MarkCheck />
                      </button>
                    }
                  />
                  {goalError !== null ? (
                    <p className="alert goal-alert" role="alert">
                      {goalError}
                    </p>
                  ) : null}
                </form>
              ) : goalShillings !== null ? (
                <button type="button" className="goal-amount" onClick={startEditGoal} aria-label="Edit goal">
                  {formatKesShillings(goalShillings)}
                </button>
              ) : null}
            </div>
            <Pot animate={false} share={fillShare}>
              <h1 className="claim-amount" style={{ ["--digits" as string]: String(digits) }}>
                <span className="claim-currency">KES</span>
                <StaticAmount value={shillings} />
              </h1>
            </Pot>
          </div>
        )}
      </section>
      <Nav />
    </main>
  );
}
