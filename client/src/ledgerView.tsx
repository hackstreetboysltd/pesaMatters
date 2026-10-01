import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LedgerBlock } from "./api";
import { MarkChain, MarkDeposit, MarkInvest, MarkMove, MarkPrice, MarkWithdraw } from "./components/marks";
import { formatKes, formatWhen } from "./format";
import { personalBlocks } from "./notices";

export { personalBlocks };

const MICRO = 1_000_000;

type Direction = "in" | "out" | "neutral";

type Statement = {
  title: string;
  detail: string | null;
  amountCents: number | null;
  direction: Direction;
  mark: ReactElement;
};

export function nameMap(members: { id: string; name: string }[]): ReadonlyMap<string, string> {
  return new Map(members.map((member) => [member.id, member.name]));
}

export function symbolMap(blocks: LedgerBlock[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const block of blocks) {
    if (block.entryType !== "invest") continue;
    const investmentId = asString(block.payload.investmentId);
    const symbol = asString(block.payload.symbol);
    if (investmentId !== null && symbol !== null) map.set(investmentId, symbol);
  }
  return map;
}

function nameOf(names: ReadonlyMap<string, string>, id: string | null): string {
  if (id === null) return "a member";
  return names.get(id) ?? "a member";
}

function asString(value: string | number | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asInt(value: string | number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function statementFor(
  block: LedgerBlock,
  names: ReadonlyMap<string, string>,
  symbols: ReadonlyMap<string, string>,
): Statement {
  const memberId = asString(block.payload.memberId);
  const counterpartyId = asString(block.payload.counterpartyId);
  const amount = asInt(block.payload.amountCents);
  const symbol = asString(block.payload.symbol);
  const name = asString(block.payload.name);
  const price = asInt(block.payload.priceCents);
  const units = asInt(block.payload.unitsMicro);
  const investmentId = asString(block.payload.investmentId);

  if (block.entryType === "genesis") {
    return { title: "Genesis", detail: "Chain opened", amountCents: null, direction: "neutral", mark: <MarkChain /> };
  }
  if (block.entryType === "deposit") {
    return {
      title: "Deposit",
      detail: nameOf(names, memberId),
      amountCents: amount,
      direction: "in",
      mark: <MarkDeposit />,
    };
  }
  if (block.entryType === "withdraw") {
    return {
      title: "Withdrawal",
      detail: nameOf(names, memberId),
      amountCents: amount,
      direction: "out",
      mark: <MarkWithdraw />,
    };
  }
  if (block.entryType === "transfer") {
    return {
      title: "Transfer",
      detail: `${nameOf(names, memberId)} to ${nameOf(names, counterpartyId)}`,
      amountCents: amount,
      direction: "neutral",
      mark: <MarkMove />,
    };
  }
  if (block.entryType === "invest") {
    const cost = units !== null && price !== null ? Math.round((units * price) / MICRO) : null;
    return {
      title: "Buy",
      detail: symbol ?? name ?? "Investment",
      amountCents: cost,
      direction: "out",
      mark: <MarkInvest />,
    };
  }
  if (block.entryType === "mark") {
    return {
      title: "Close",
      detail: (investmentId !== null ? symbols.get(investmentId) : null) ?? symbol ?? name ?? "Investment",
      amountCents: price,
      direction: "neutral",
      mark: <MarkPrice />,
    };
  }
  return {
    title: block.entryType,
    detail: null,
    amountCents: amount,
    direction: "neutral",
    mark: <MarkChain />,
  };
}

function formatSignedKes(cents: number, direction: Direction): string {
  const money = formatKes(cents);
  if (direction === "in") return `+${money}`;
  if (direction === "out") return `−${money}`;
  return money;
}

export function LedgerEntry({
  block,
  names,
  symbols,
  hashesOpen,
  onToggleHashes,
  fault = false,
  mark,
}: {
  block: LedgerBlock;
  names: ReadonlyMap<string, string>;
  symbols: ReadonlyMap<string, string>;
  hashesOpen: boolean;
  onToggleHashes: () => void;
  fault?: boolean;
  mark?: ReactNode;
}): ReactElement {
  const statement = statementFor(block, names, symbols);
  const hashPanelId = `block-hashes-${block.id}`;
  const paymentId = asString(block.payload.paymentId);
  const receiptTo =
    paymentId !== null && (block.entryType === "deposit" || block.entryType === "withdraw" || block.entryType === "transfer")
      ? `/receipts/${paymentId}`
      : null;
  const body = (
    <>
      <div className="ledger-text">
        <h2 className="ledger-title">{statement.title}</h2>
        <p className="ledger-meta">
          {statement.detail !== null ? `${statement.detail} · ` : null}
          {formatWhen(block.createdAt)}
        </p>
      </div>
      {statement.amountCents !== null ? (
        <p className={`ledger-amount is-${statement.direction}`}>{formatSignedKes(statement.amountCents, statement.direction)}</p>
      ) : (
        <p className="ledger-amount is-empty" aria-hidden="true">
          —
        </p>
      )}
    </>
  );
  return (
    <article className={`ledger-row${fault ? " is-fault" : ""}`}>
      {mark ?? (
        <div className="ledger-mark" aria-hidden="true">
          {statement.mark}
        </div>
      )}
      <div className="ledger-copy">
        {receiptTo !== null ? (
          <Link className="ledger-main" to={receiptTo}>
            {body}
          </Link>
        ) : (
          <div className="ledger-main">{body}</div>
        )}
        <button
          type="button"
          className="hash-toggle"
          aria-expanded={hashesOpen}
          aria-controls={hashPanelId}
          onClick={onToggleHashes}
        >
          {hashesOpen ? "Hide hashes" : "Hashes"}
        </button>
        {hashesOpen ? (
          <div id={hashPanelId} className="block-hashes">
            <p className="hash">
              <span className="hash-label">Prev</span> {block.prevHash}
            </p>
            <p className="hash">
              <span className="hash-label">Hash</span> {block.hash}
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}
