import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { hasOauthHandoffParams } from "./auth/googleStart";
import { api, setUnauthenticatedHandler, type Member } from "./api";
import { Pot, PotWordmark } from "./components/Pot";
import { safeReturnTo } from "./returnTo";

type SessionValue = {
  ready: boolean;
  member: Member | null;
  refresh: () => Promise<Member | null>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

function loginPath(returnTo: string): string {
  const safe = safeReturnTo(returnTo);
  if (safe === "/") return "/login";
  return `/login?returnTo=${encodeURIComponent(safe)}`;
}

export function SessionProvider({ children }: { children: ReactNode }): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [member, setMember] = useState<Member | null | undefined>(undefined);

  const refresh = useCallback(async (): Promise<Member | null> => {
    try {
      const payload = await api.me();
      setMember(payload.member);
      return payload.member;
    } catch {
      setMember(null);
      return null;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      /* still clear local session */
    }
    setMember(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const payload = await api.me();
        if (active) setMember(payload.member);
      } catch {
        if (active) setMember(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setMember(null);
      const next = loginPath(`${window.location.pathname}${window.location.search}`);
      if (window.location.pathname === "/login") return;
      window.location.replace(next);
    });
    return () => setUnauthenticatedHandler(null);
  }, []);

  useEffect(() => {
    if (member === undefined) return;
    const onLogin = location.pathname === "/login";
    if (member === null && !onLogin) {
      navigate(loginPath(`${location.pathname}${location.search}`), { replace: true });
      return;
    }
    if (member !== null && onLogin) {
      if (hasOauthHandoffParams(location.search)) return;
      const params = new URLSearchParams(location.search);
      navigate(safeReturnTo(params.get("returnTo")), { replace: true });
    }
  }, [location.pathname, location.search, member, navigate]);

  const value = useMemo<SessionValue>(
    () => ({
      ready: member !== undefined,
      member: member ?? null,
      refresh,
      logout,
    }),
    [logout, member, refresh],
  );

  if (member === undefined || (member === null && location.pathname !== "/login")) {
    return (
      <main className="login" aria-busy="true">
        <div className="login-stage">
          <Pot className="pot-login" idle>
            <PotWordmark />
          </Pot>
        </div>
      </main>
    );
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
