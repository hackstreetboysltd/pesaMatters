import { useEffect, useMemo, useRef, useState } from "react";
import { animated, to, useSpring, useSprings } from "@react-spring/web";
import { ApiError, api, type LedgerBlock } from "../api";
import { BackLink } from "../components/BackLink";
import { MarkVerify } from "../components/marks";
import { Nav } from "../components/Nav";
import { Pager } from "../components/Pager";
import { LedgerEntry, nameMap, statementFor, symbolMap } from "../ledgerView";
import { useReducedMotion } from "../motion";
import { PAGE_SIZE, pageWindow } from "../paging";

const EMBER = "#ff5c1a";
const SEAL = "#1e6b45";
const FAULT = "#b42318";
const MARK_IDLE = "var(--slip)";
const HOLD_MS = 1100;

function stepMs(length: number): number {
  if (length <= 8) return 220;
  return Math.max(90, Math.round(2200 / length));
}

type VerifyOutcome =
  | { ok: true; length: number }
  | { ok: false; index: number; reason: string };

type Phase = "idle" | "checking" | "success" | "failure";

export function Ledger(): React.ReactElement {
  const [blocks, setBlocks] = useState<LedgerBlock[] | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [faultAt, setFaultAt] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [openHashes, setOpenHashes] = useState<ReadonlySet<number>>(() => new Set());
  const reduced = useReducedMotion();
  const runId = useRef(0);
  const listTop = useRef<HTMLDivElement | null>(null);

  const count = blocks?.length ?? 0;
  const newestFirst = useMemo(() => (blocks === null ? [] : [...blocks].reverse()), [blocks]);
  const symbols = useMemo(() => symbolMap(blocks ?? []), [blocks]);
  const slice = pageWindow(newestFirst.length, page);
  const pageItems = newestFirst.slice(slice.start, slice.end);

  const [nodeSprings, nodeApi] = useSprings(
    count,
    () => ({
      tone: 0,
      pulse: 1,
      config: { tension: 280, friction: 22 },
    }),
    [count],
  );

  const seal = useSpring({
    opacity: phase === "success" ? 1 : 0,
    scale: phase === "success" ? 1 : 0.72,
    y: phase === "success" ? 0 : 12,
    immediate: reduced,
    config: { tension: 260, friction: 18 },
  });

  useEffect(() => {
    let active = true;
    Promise.all([api.ledger(), api.members()])
      .then(([payload, crew]) => {
        if (!active) return;
        setBlocks(payload.blocks);
        setNames(nameMap(crew.members));
        setPage(0);
        setOpenHashes(new Set());
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not read the chain.");
      });
    return () => {
      active = false;
      runId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (page !== slice.page) setPage(slice.page);
  }, [page, slice.page]);

  function goToPage(next: number): void {
    setPage(next);
    setOpenHashes(new Set());
    listTop.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }

  function toggleHashes(blockId: number): void {
    setOpenHashes((current) => {
      const next = new Set(current);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }

  async function resetNodes(): Promise<void> {
    await Promise.all(
      nodeApi.start((index) => ({
        tone: 0,
        pulse: 1,
        delay: reduced ? 0 : index * 24,
      })),
    );
  }

  async function playSuccess(length: number, token: number): Promise<void> {
    if (token !== runId.current) return;
    const step = stepMs(length);
    if (reduced) {
      await Promise.all(nodeApi.start(() => ({ tone: 1, pulse: 1.05, immediate: true })));
    } else {
      for (let index = 0; index < length; index += 1) {
        if (token !== runId.current) return;
        await Promise.all(
          nodeApi.start((i) =>
            i === index
              ? { tone: 1, pulse: 1.12, config: { tension: 320, friction: 16 } }
              : i < index
                ? { tone: 1, pulse: 1 }
                : { tone: 0, pulse: 1 },
          ),
        );
        await wait(step);
        if (token !== runId.current) return;
        void nodeApi.start((i) => (i === index ? { pulse: 1 } : {}));
      }
    }
    if (token !== runId.current) return;
    setStatus(`Chain is sound. ${length} blocks.`);
    setPhase("success");
    await wait(reduced ? 700 : HOLD_MS);
    if (token !== runId.current) return;
    setPhase("idle");
    setStatus(null);
    await resetNodes();
  }

  async function playFailure(outcome: Extract<VerifyOutcome, { ok: false }>, length: number, token: number): Promise<void> {
    if (token !== runId.current) return;
    const breakIndex = outcome.index >= 0 && outcome.index < length ? outcome.index : null;
    const walkTo = breakIndex === null ? length : breakIndex;
    const step = stepMs(Math.max(walkTo, 1));

    if (breakIndex !== null) {
      const newestIndex = length - 1 - breakIndex;
      goToPage(Math.floor(newestIndex / PAGE_SIZE));
    }

    if (reduced) {
      await Promise.all(
        nodeApi.start((i) => ({
          tone: breakIndex !== null && i === breakIndex ? 2 : breakIndex !== null && i < breakIndex ? 1 : breakIndex === null ? 2 : 0,
          pulse: 1,
          immediate: true,
        })),
      );
    } else {
      for (let index = 0; index < walkTo; index += 1) {
        if (token !== runId.current) return;
        await Promise.all(
          nodeApi.start((i) =>
            i === index
              ? { tone: 1, pulse: 1.12 }
              : i < index
                ? { tone: 1, pulse: 1 }
                : { tone: 0, pulse: 1 },
          ),
        );
        await wait(step);
        if (token !== runId.current) return;
        void nodeApi.start((i) => (i === index ? { pulse: 1 } : {}));
      }
      if (breakIndex !== null) {
        await Promise.all(
          nodeApi.start((i) =>
            i === breakIndex ? { tone: 2, pulse: 1.16, config: { tension: 380, friction: 14 } } : i < breakIndex ? { tone: 1 } : { tone: 0 },
          ),
        );
        await wait(160);
        if (token !== runId.current) return;
        void nodeApi.start((i) => (i === breakIndex ? { pulse: 1 } : {}));
      } else if (length > 0) {
        await Promise.all(nodeApi.start(() => ({ tone: 2, pulse: 1.08 })));
        await wait(160);
        void nodeApi.start(() => ({ pulse: 1 }));
      }
    }

    if (token !== runId.current) return;
    setFaultAt(breakIndex);
    setStatus(messageForFailure(outcome, length));
    setPhase("failure");
    await wait(reduced ? 1200 : 2200);
    if (token !== runId.current) return;
    setPhase("idle");
    setFaultAt(null);
    setStatus(null);
    await resetNodes();
  }

  async function check(): Promise<void> {
    if (blocks === null || phase === "checking" || phase === "success") return;
    const token = ++runId.current;
    setError(null);
    setStatus(null);
    setFaultAt(null);
    setPhase("checking");
    await resetNodes();

    let outcome: VerifyOutcome;
    try {
      outcome = await verifyChainRequest();
    } catch {
      if (token !== runId.current) return;
      setPhase("idle");
      setStatus("Could not verify the chain.");
      return;
    }

    if (token !== runId.current) return;
    if (outcome.ok) {
      await playSuccess(outcome.length, token);
      return;
    }
    await playFailure(outcome, blocks.length, token);
  }

  const busy = phase === "checking" || phase === "success";
  const verifying = phase === "checking" || phase === "success" || phase === "failure";

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <BackLink to="/move" label="Back to Move" />
          <h1 className="screen-title">Ledger</h1>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void check()}
            disabled={blocks === null || busy}
            aria-label="Verify"
            aria-busy={busy}
          >
            <MarkVerify />
          </button>
        </header>
        {status !== null ? (
          <p className={phase === "failure" ? "alert" : "status"} role="status">
            {status}
          </p>
        ) : null}
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        <div
          ref={listTop}
          className={`ledger${phase === "success" ? " ledger-sound" : ""}${phase === "failure" ? " ledger-broken" : ""}`}
        >
          <animated.div
            className="chain-seal"
            aria-hidden={phase !== "success"}
            style={{
              opacity: seal.opacity,
              transform: to([seal.scale, seal.y], (scale, y) => `translate(-50%, calc(-50% + ${y}px)) scale(${scale})`),
            }}
          >
            <span className="chain-seal-mark" aria-hidden="true">
              <MarkVerify />
            </span>
            <span className="chain-seal-label">Sound</span>
          </animated.div>
          {pageItems.map((block, pageIndex) => {
            const displayIndex = slice.start + pageIndex;
            const chainIndex = count - 1 - displayIndex;
            const spring = nodeSprings[chainIndex];
            const statement = statementFor(block, names, symbols);
            return (
              <LedgerEntry
                key={block.id}
                block={block}
                names={names}
                symbols={symbols}
                hashesOpen={openHashes.has(block.id)}
                onToggleHashes={() => toggleHashes(block.id)}
                fault={faultAt === chainIndex}
                mark={
                  <animated.div
                    className="ledger-mark"
                    aria-hidden="true"
                    style={{
                      color: verifying
                        ? spring?.tone.to((tone) => (tone === 0 ? "var(--ink-on-slip)" : mixTone(tone)))
                        : undefined,
                      background: verifying
                        ? spring?.tone.to((tone) =>
                            tone === 0 ? MARK_IDLE : `color-mix(in srgb, ${mixTone(tone)} 22%, var(--slip))`,
                          )
                        : undefined,
                      transform: spring?.pulse.to((pulse) => `scale(${pulse})`),
                    }}
                  >
                    {statement.mark}
                  </animated.div>
                }
              />
            );
          })}
        </div>
        {blocks !== null ? (
          <Pager label="Ledger pages" total={newestFirst.length} slice={slice} onPage={goToPage} />
        ) : null}
      </main>
      <Nav />
    </>
  );
}

function mixTone(tone: number): string {
  if (tone <= 1) return lerpHex(EMBER, SEAL, tone);
  return lerpHex(SEAL, FAULT, Math.min(1, tone - 1));
}

function lerpHex(from: string, to: string, t: number): string {
  const [ar, ag, ab] = hexRgb(from);
  const [br, bg, bb] = hexRgb(to);
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * t);
  return `rgb(${mix(ar, br)} ${mix(ag, bg)} ${mix(ab, bb)})`;
}

function hexRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  return [Number.parseInt(raw.slice(0, 2), 16), Number.parseInt(raw.slice(2, 4), 16), Number.parseInt(raw.slice(4, 6), 16)];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function verifyChainRequest(): Promise<VerifyOutcome> {
  const response = await fetch("/api/ledger/verify", { credentials: "include" });
  const body: unknown = await response.json();
  if (response.ok) {
    const length =
      body !== null && typeof body === "object" && "length" in body && typeof (body as { length?: unknown }).length === "number"
        ? (body as { length: number }).length
        : 0;
    return { ok: true, length };
  }
  if (body !== null && typeof body === "object") {
    const record = body as { ok?: unknown; index?: unknown; reason?: unknown };
    if (record.ok === false && typeof record.index === "number" && typeof record.reason === "string") {
      return { ok: false, index: record.index, reason: record.reason };
    }
  }
  return { ok: false, index: -1, reason: "the chain does not match its records" };
}

function messageForFailure(outcome: Extract<VerifyOutcome, { ok: false }>, length: number): string {
  if (outcome.index >= 0 && outcome.index < length) {
    return `Break at block ${outcome.index + 1}. ${plainReason(outcome.reason)}`;
  }
  return plainReason(outcome.reason);
}

function plainReason(reason: string): string {
  if (reason === "prev hash does not match the previous block") return "A link no longer points at the block before it.";
  if (reason === "hash does not match the payload") return "A block's hash no longer matches what it stores.";
  if (reason === "treasury does not match the chain") return "Treasury cash no longer matches the chain.";
  if (reason === "a claim does not match the chain") return "A member claim no longer matches the chain.";
  if (reason === "missing block") return "A block is missing from the chain.";
  return "The chain does not match its records.";
}
