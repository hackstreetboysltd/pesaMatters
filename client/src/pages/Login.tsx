import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api";
import {
  beginGoogleSignIn,
  claimOauthCompletion,
  clearGooglePending,
  hasOauthHandoffParams,
  pendingMatches,
  readGooglePending,
} from "../auth/googleStart";
import { Pot, PotWordmark } from "../components/Pot";
import { safeReturnTo } from "../returnTo";
import { useSession } from "../session";

const ERRORS: Record<string, string> = {
  google: "Google sign-in did not finish. Try again.",
  google_off: "Google sign-in needs a client id and secret in the server environment.",
  google_unconfigured: "Google sign-in needs a client id and secret in the server environment.",
  google_denied: "Google sign-in was cancelled.",
  google_failed: "Google sign-in did not finish. Try again.",
  google_cookie: "That sign-in expired. Try Continue with Google again.",
  google_state: "That sign-in expired. Try Continue with Google again.",
  google_rejected: "Google rejected that sign-in. Reload the page and try again.",
  google_client: "Google rejected the client secret. Check it in the server environment and restart the API.",
  google_redirect: "The Google redirect address does not match this app.",
  google_network: "Could not reach Google. Check the network, then try again.",
  google_clock: "This device's clock is wrong. Set the correct date and time, then try again.",
  google_conflict: "That Google email is already tied to another account.",
  email_unverified: "That Google account has not verified its email.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  csrf: "Refresh the page and try again.",
};

const FALLBACK = "Google sign-in did not finish. Try again.";

export function Login(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const { refresh } = useSession();
  const params = new URLSearchParams(location.search);
  const returnTo = safeReturnTo(params.get("returnTo"));
  const completing = hasOauthHandoffParams(location.search);
  const [startError, setStartError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const queryError = params.get("error");
  const error = completing ? undefined : (messageFor(queryError) ?? startError ?? undefined);
  const ready = error === undefined && !completing && !leaving;

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    const code = search.get("code");
    const state = search.get("state");
    if (code === null || state === null || code.length === 0 || state.length === 0) return;
    if (!claimOauthCompletion(state, code)) return;
    const pending = readGooglePending();
    if (pending === null || !pendingMatches(pending, state)) {
      clearGooglePending();
      navigate("/login?error=google_state", { replace: true });
      return;
    }
    const next = pending.returnTo;
    void (async () => {
      try {
        await api.googleCallback({ code, verifier: pending.verifier });
        clearGooglePending();
        await refresh();
        navigate(next, { replace: true });
      } catch (err) {
        clearGooglePending();
        const name = err instanceof ApiError ? err.code : "google_network";
        navigate(`/login?error=${allow(name)}`, { replace: true });
      }
    })();
  }, [location.search, navigate, refresh]);

  async function onGoogle(): Promise<void> {
    setStartError(null);
    setLeaving(true);
    try {
      await beginGoogleSignIn(returnTo);
    } catch (err) {
      setLeaving(false);
      const name = err instanceof ApiError ? err.code : "google_network";
      setStartError(messageFor(name) ?? FALLBACK);
    }
  }

  return (
    <main className="login" id="main">
      <div className="login-stage">
        <Pot className="pot-login" share={ready ? 0.72 : 0.18} idle={!ready && error === undefined}>
          <PotWordmark as="h1" />
        </Pot>
        {error !== undefined ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="login-dock">
        <button className="google-continue" type="button" disabled={leaving || completing} onClick={() => void onGoogle()}>
          <GoogleMark />
          Continue with Google
        </button>
      </div>
    </main>
  );
}

function allow(code: string): string {
  return Object.prototype.hasOwnProperty.call(ERRORS, code) ? code : "google";
}

function messageFor(code: string | null): string | undefined {
  if (code === null) return undefined;
  if (Object.prototype.hasOwnProperty.call(ERRORS, code)) return ERRORS[code];
  return FALLBACK;
}

function GoogleMark(): React.ReactElement {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.7-6.6 7.1l.1.1 6.3 5.3C36.9 41.4 44 36 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
