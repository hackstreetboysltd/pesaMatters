import type { LedgerBlock } from "./api.ts";
import { formatKes } from "./format.ts";

export type Notice = {
  id: string;
  at: string;
  text: string;
};

export type NoticeStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const LIMIT = 80;

function storageKey(memberId: string): string {
  return `hackstreet-notices:${memberId}`;
}

function isNotice(value: unknown): value is Notice {
  if (value === null || typeof value !== "object") return false;
  const record = value as { id?: unknown; at?: unknown; text?: unknown };
  return typeof record.id === "string" && typeof record.at === "string" && typeof record.text === "string";
}

export function readNotices(memberId: string, store: NoticeStore): Notice[] {
  const raw = store.getItem(storageKey(memberId));
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isNotice);
  } catch {
    return [];
  }
}

/** Append one success. Same id is kept once, so a retried write does not double. */
export function recordNotice(memberId: string, notice: Notice, store: NoticeStore): Notice[] {
  const current = readNotices(memberId, store).filter((item) => item.id !== notice.id);
  const next = [...current, notice].slice(-LIMIT);
  store.setItem(storageKey(memberId), JSON.stringify(next));
  return next;
}

export function accountNotice(memberId: string, createdAt: string): Notice {
  return {
    id: `account:${memberId}`,
    at: createdAt,
    text: "Successfully created account",
  };
}

function asString(value: string | number | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asInt(value: string | number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nameOf(names: ReadonlyMap<string, string>, id: string | null): string {
  if (id === null) return "a member";
  return names.get(id) ?? "a member";
}

/** This member's deposits, withdrawals, buys, and transfers they sent or received. */
export function personalBlocks(blocks: LedgerBlock[], memberId: string): LedgerBlock[] {
  return blocks.filter((block) => {
    const actor = asString(block.payload.memberId);
    const counterparty = asString(block.payload.counterpartyId);
    if (block.entryType === "deposit" || block.entryType === "withdraw" || block.entryType === "invest") {
      return actor === memberId;
    }
    if (block.entryType === "transfer") return actor === memberId || counterparty === memberId;
    return false;
  });
}

/** Success lines for this member's own ledger actions. Received transfers stay on Activity. */
export function actionNotices(
  blocks: LedgerBlock[],
  memberId: string,
  names: ReadonlyMap<string, string>,
): Notice[] {
  const notices: Notice[] = [];
  for (const block of blocks) {
    const actor = asString(block.payload.memberId);
    if (actor !== memberId) continue;
    const amount = asInt(block.payload.amountCents);
    const money = formatKes(amount ?? 0);
    if (block.entryType === "deposit") {
      notices.push({ id: `block:${block.id}`, at: block.createdAt, text: `Successfully deposited ${money}` });
    } else if (block.entryType === "withdraw") {
      notices.push({ id: `block:${block.id}`, at: block.createdAt, text: `Successfully withdrew ${money}` });
    } else if (block.entryType === "transfer") {
      const counterparty = asString(block.payload.counterpartyId);
      notices.push({
        id: `block:${block.id}`,
        at: block.createdAt,
        text: `Successfully sent ${money} to ${nameOf(names, counterparty)}`,
      });
    } else if (block.entryType === "invest") {
      const symbol = asString(block.payload.symbol) ?? asString(block.payload.name) ?? "an investment";
      notices.push({ id: `block:${block.id}`, at: block.createdAt, text: `Successfully bought ${symbol}` });
    }
  }
  return notices;
}

const NOTICE_HEADS: { prefix: string; title: string }[] = [
  { prefix: "Successfully deposited ", title: "Successfully deposited" },
  { prefix: "Successfully withdrew ", title: "Successfully withdrew" },
  { prefix: "Successfully sent ", title: "Successfully sent" },
  { prefix: "Successfully bought ", title: "Successfully bought" },
  { prefix: "Successfully set goal to ", title: "Successfully set goal" },
  { prefix: "Successfully changed theme to ", title: "Successfully changed theme" },
];

/** Title plus the quieter line under it, for the Info notification rows. */
export function noticeView(notice: Notice): { title: string; detail: string | null } {
  for (const head of NOTICE_HEADS) {
    if (notice.text.startsWith(head.prefix)) {
      const detail = notice.text.slice(head.prefix.length).trim();
      return { title: head.title, detail: detail.length > 0 ? detail : null };
    }
  }
  if (notice.text === "Successfully created account") {
    return { title: notice.text, detail: "Your account is ready." };
  }
  return { title: notice.text, detail: null };
}

export function mergeNotices(groups: Notice[][]): Notice[] {
  const byId = new Map<string, Notice>();
  for (const group of groups) {
    for (const notice of group) {
      if (!byId.has(notice.id)) byId.set(notice.id, notice);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
