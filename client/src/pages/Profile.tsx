import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type LedgerBlock, type Member } from "../api";
import { BackLink } from "../components/BackLink";
import { Nav } from "../components/Nav";
import { Pager } from "../components/Pager";
import { formatKes, formatNoticeDay } from "../format";
import { LedgerEntry, nameMap, personalBlocks, symbolMap } from "../ledgerView";
import { useReducedMotion } from "../motion";
import { accountNotice, actionNotices, mergeNotices, noticeView, readNotices, recordNotice, type Notice } from "../notices";
import { pageWindow } from "../paging";
import { useSession } from "../session";
import { THEMES, useTheme, type Appearance } from "../theme";

type Tab = "info" | "activity" | "personalization";

export function Profile(): React.ReactElement {
  const { member: sessionMember, logout } = useSession();
  const { appearance, setAppearance } = useTheme();
  const [tab, setTab] = useState<Tab>("info");
  const [member, setMember] = useState<Member | null>(sessionMember);
  const [claim, setClaim] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<LedgerBlock[] | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [localNotices, setLocalNotices] = useState<Notice[]>([]);
  const [openHashes, setOpenHashes] = useState<ReadonlySet<number>>(() => new Set());
  const [noticePage, setNoticePage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const noticeTop = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.me(), api.ledger(), api.members()])
      .then(([me, ledger, crew]) => {
        if (!active) return;
        setMember(me.member);
        setClaim(me.claimCents);
        setBlocks(ledger.blocks);
        setNames(nameMap(crew.members));
        setLocalNotices(readNotices(me.member.id, localStorage));
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof ApiError ? caught.message : "Could not load your profile.");
      });
    return () => {
      active = false;
    };
  }, []);

  const notices = useMemo(() => {
    if (member === null) return [];
    return mergeNotices([
      [accountNotice(member.id, member.createdAt)],
      actionNotices(blocks ?? [], member.id, names),
      localNotices,
    ]);
  }, [blocks, localNotices, member, names]);

  const noticeSlice = pageWindow(notices.length, noticePage);
  const noticeItems = notices.slice(noticeSlice.start, noticeSlice.end);

  useEffect(() => {
    if (noticePage !== noticeSlice.page) setNoticePage(noticeSlice.page);
  }, [noticePage, noticeSlice.page]);

  const mine = useMemo(() => {
    if (member === null || blocks === null) return null;
    return personalBlocks(blocks, member.id).slice().reverse();
  }, [blocks, member]);

  const symbols = useMemo(() => symbolMap(blocks ?? []), [blocks]);

  async function onSignOut(): Promise<void> {
    await logout();
  }

  function onTheme(next: Appearance): void {
    if (next === appearance || member === null) {
      setAppearance(next);
      return;
    }
    setAppearance(next);
    const label = THEMES.find((theme) => theme.id === next)?.name ?? next;
    setLocalNotices(
      recordNotice(
        member.id,
        { id: `theme:${crypto.randomUUID()}`, at: new Date().toISOString(), text: `Successfully changed theme to ${label}` },
        localStorage,
      ),
    );
    setNoticePage(0);
  }

  function goToNoticePage(next: number): void {
    setNoticePage(next);
    noticeTop.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }

  function toggleHashes(id: number): void {
    setOpenHashes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <main className="screen" id="main">
        <header className="screen-head">
          <BackLink to="/" label="Back to Pot" />
          <div className="profile-id">
            <h1 className="screen-title">{member?.name ?? "You"}</h1>
            {member !== null ? <p className="profile-mail">{member.email}</p> : null}
          </div>
          <button type="button" className="icon-btn" aria-label="Log out" onClick={() => void onSignOut()}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
              <path d="M16 16l4-4-4-4" />
              <path d="M20 12H10" />
            </svg>
          </button>
        </header>
        <div className="tabs" role="tablist" aria-label="Profile">
          {(
            [
              ["info", "Info"],
              ["activity", "Activity"],
              ["personalization", "Personalization"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="tab"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        {tab === "info" ? (
          <section className="panel" role="tabpanel" id="panel-info" aria-labelledby="tab-info">
            {member === null ? null : (
              <>
                <p className="money-hero">{claim === null ? "…" : formatKes(claim)}</p>
                <h2 className="notice-label" ref={noticeTop}>
                  Notifications
                </h2>
                <ul className="notice-list">
                  {noticeItems.map((notice) => {
                    const view = noticeView(notice);
                    return (
                      <li key={notice.id} className="notice-row">
                        <div className="notice-copy">
                          <p className="notice-title">{view.title}</p>
                          {view.detail !== null ? <p className="notice-detail">{view.detail}</p> : null}
                        </div>
                        <time className="notice-when" dateTime={notice.at}>
                          {formatNoticeDay(notice.at)}
                        </time>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        ) : null}
        {tab === "info" && member !== null ? (
          <Pager label="Notification pages" total={notices.length} slice={noticeSlice} onPage={goToNoticePage} />
        ) : null}
        {tab === "activity" ? (
          <section role="tabpanel" id="panel-activity" aria-labelledby="tab-activity">
            {mine === null ? null : mine.length === 0 ? (
              <p className="hint">Nothing moved.</p>
            ) : (
              <div className="ledger">
                {mine.map((block) => (
                  <LedgerEntry
                    key={block.id}
                    block={block}
                    names={names}
                    symbols={symbols}
                    hashesOpen={openHashes.has(block.id)}
                    onToggleHashes={() => toggleHashes(block.id)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
        {tab === "personalization" ? (
          <section className="panel" role="tabpanel" id="panel-personalization" aria-labelledby="tab-personalization">
            <div className="theme-grid" role="radiogroup" aria-label="Theme">
              {THEMES.map((theme) => {
                const selected = appearance === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`theme-card${selected ? " is-selected" : ""}`}
                    onClick={() => onTheme(theme.id)}
                  >
                    <span className="theme-stage" style={{ background: theme.stage.bg }} aria-hidden="true">
                      <span className="theme-stage-bar" style={{ background: theme.stage.bar }} />
                      <span
                        className="theme-stage-line"
                        style={{ background: theme.stage.ink, width: "72%" }}
                      />
                      <span
                        className="theme-stage-line is-mute"
                        style={{ background: theme.stage.mute, width: "46%" }}
                      />
                      <span className="theme-stage-dock" style={{ background: theme.stage.dock }}>
                        <span style={{ background: theme.stage.accent }} />
                      </span>
                    </span>
                    <span className="theme-name">{theme.name}</span>
                    <span className="theme-note">{theme.note}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </main>
      <Nav />
    </>
  );
}
