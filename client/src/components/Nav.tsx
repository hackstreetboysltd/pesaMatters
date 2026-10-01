import { NavLink, useLocation } from "react-router-dom";
import { animated, useSpring } from "@react-spring/web";
import type { ComponentType, CSSProperties } from "react";
import { MarkInvest, MarkLoan, MarkMove, MarkPot, MarkYou } from "./marks";
import { useReducedMotion } from "../motion";

type NavLinkItem = {
  to: string;
  label: string;
  end: boolean;
  icon: ComponentType;
};

const memberLinks: NavLinkItem[] = [
  { to: "/", label: "Pot", end: true, icon: MarkPot },
  { to: "/move", label: "Move", end: false, icon: MarkMove },
  { to: "/loans", label: "Loans", end: false, icon: MarkLoan },
  { to: "/invest", label: "Invest", end: false, icon: MarkInvest },
  { to: "/you", label: "You", end: false, icon: MarkYou },
];

export function Nav({ links = memberLinks }: { links?: readonly NavLinkItem[] }): React.ReactElement {
  const { pathname } = useLocation();
  const reduced = useReducedMotion();
  const index = links.findIndex((link) => (link.end ? pathname === link.to : pathname === link.to || pathname.startsWith(`${link.to}/`)));
  const { x } = useSpring({
    x: index < 0 ? 0 : index,
    immediate: reduced,
    config: { tension: 280, friction: 26 },
  });

  const count = String(links.length);
  return (
    <nav className="nav" aria-label="Crew" style={{ "--nav-count": count } as CSSProperties}>
      <animated.span
        className="nav-dot"
        aria-hidden="true"
        style={{
          opacity: index < 0 ? 0 : 1,
          transform: x.to((value) => `translateX(${value * 100}%)`),
        }}
      />
      {links.map((link) => (
        <NavLink key={link.to} to={link.to} end={link.end}>
          <link.icon />
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
