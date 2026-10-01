import { randomBytes, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { log } from "./logger.ts";
import {
  exchangeGoogleCode,
  googleCallbackHandoff,
  googleSignInFailure,
  loadGoogleCerts,
  rawQueryParam,
} from "./google.ts";
import { MoneyError } from "./money.ts";
import { liveRails, mockRails, type Rails } from "./mpesa/client.ts";
import { B2cResultBody, receiptFromB2c, receiptFromStk, StkCallbackBody } from "./mpesa/callback.ts";
import { kenyanMsisdn } from "./mpesa/phone.ts";
import { registerDeskRoutes, registerMemberLoanRoutes } from "./loans/http.ts";
import { LoanError } from "./loans/service.ts";
import { PaymentError, applyDarajaResult, checkPayment, receiptFile, receiptFor, startPayment } from "./payments.ts";
import {
  QuoteError,
  createQuoteSource,
  dayChangeBps,
  nairobiDate,
  type CloseQuote,
  type QuoteSource,
} from "./quotes.ts";
import { nseShares } from "./symbols.ts";
import {
  activityFor,
  appendEntry,
  closeSession,
  getInvestment,
  homeFor,
  listBlocks,
  listInvestments,
  listMembers,
  GoogleAccountConflict,
  memberFromGoogle,
  memberFromToken,
  newCsrfToken,
  openSession,
  verifyStoredChain,
  type Member,
} from "./store.ts";

const SESSION = "hs_session";
const CSRF = "hs_csrf";

const GoogleCallbackBody = z.object({
  code: z.string().min(8).max(8192),
  verifier: z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/),
});

const GOOGLE_FAIL: Record<string, { status: number; message: string }> = {
  google: { status: 502, message: "Google sign-in did not finish. Try again." },
  google_off: {
    status: 503,
    message: "Google sign-in needs a client id and secret in the server environment.",
  },
  google_state: { status: 400, message: "That sign-in expired. Try Continue with Google again." },
  google_network: { status: 502, message: "Could not reach Google. Check the network, then try again." },
  google_clock: {
    status: 409,
    message: "This device's clock is wrong. Set the correct date and time, then try again.",
  },
  google_conflict: { status: 409, message: "That Google email is already tied to another account." },
  google_client: {
    status: 502,
    message: "Google rejected the client secret. Check it in the server environment and restart the API.",
  },
  google_redirect: { status: 502, message: "The Google redirect address does not match this app." },
  email_unverified: { status: 403, message: "That Google account has not verified its email." },
};

type Authed = Request & { member?: Member };

const PaymentBody = z.object({
  kind: z.enum(["deposit", "withdraw", "transfer"]),
  amountCents: z.number().int().positive().max(100_000_000_00),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  phone: z.string().max(20).optional(),
  toMemberId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
});

const MPESA_CALLBACKS = new Set([
  "/api/payments/mpesa/stk",
  "/api/payments/mpesa/b2c",
  "/api/payments/mpesa/b2c-timeout",
]);

const InvestBody = z.object({
  symbol: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(80).optional(),
  units: z.number().positive().max(1_000_000),
});

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string): void {
  const now = Date.now();
  const slot = attempts.get(key);
  if (slot === undefined || slot.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  slot.count += 1;
  if (slot.count > 20) {
    throw new HttpError(429, "rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.");
  }
}

function cookiesOf(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (header === undefined) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      continue;
    }
  }
  return out;
}

function setCookie(
  res: Response,
  name: string,
  value: string,
  config: AppConfig,
  httpOnly: boolean,
  maxAgeSeconds = 60 * 60 * 12,
): void {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    httpOnly ? "HttpOnly" : "",
    config.cookieSecure ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`,
  ].filter((bit) => bit.length > 0);
  const existing = res.getHeader("Set-Cookie");
  const next = bits.join("; ");
  if (existing === undefined) {
    res.setHeader("Set-Cookie", next);
    return;
  }
  const list = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader("Set-Cookie", [...list, next]);
}

function clearCookie(res: Response, name: string, config: AppConfig): void {
  const bits = [
    `${name}=`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    config.cookieSecure ? "Secure" : "",
  ].filter((bit) => bit.length > 0);
  const existing = res.getHeader("Set-Cookie");
  const next = bits.join("; ");
  if (existing === undefined) {
    res.setHeader("Set-Cookie", next);
    return;
  }
  const list = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader("Set-Cookie", [...list, next]);
}

function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function asyncRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export function createApp(pool: Db, config: AppConfig, quotes: QuoteSource = createQuoteSource()): express.Express {
  const rails: Rails = config.mpesa.mode === "live" ? liveRails(config.mpesa) : mockRails();
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (config.cookieSecure) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === config.appOrigin) {
      res.setHeader("Access-Control-Allow-Origin", config.appOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/auth/csrf", (req, res) => {
    const cookies = cookiesOf(req);
    const current = cookies[CSRF];
    const token = current !== undefined && current.length > 10 ? current : newCsrfToken();
    setCookie(res, CSRF, token, config, false);
    res.json({ ok: true });
  });

  app.use((req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || MPESA_CALLBACKS.has(req.path)) {
      next();
      return;
    }
    const cookies = cookiesOf(req);
    const cookie = cookies[CSRF];
    const header = req.header("x-csrf-token");
    if (cookie === undefined || header === undefined || !tokensMatch(cookie, header)) {
      next(new HttpError(403, "csrf", "Refresh the page and try that again."));
      return;
    }
    next();
  });

  app.get("/api/auth/google", (_req, res) => {
    if (config.google === null) {
      res.json({ enabled: false });
      return;
    }
    res.json({
      enabled: true,
      clientId: config.google.clientId,
      redirectUri: googleRedirectUri(config),
    });
  });

  // Google returns here. Hand the code to the SPA; do not exchange it and do not read a cookie.
  app.get("/api/auth/google/callback", (req, res) => {
    const providerError = rawQueryParam(req.originalUrl, "error");
    if (providerError !== null) {
      log.warn("google_signin_failed", { reason: providerError === "access_denied" ? "google_denied" : "google", detail: null });
    }
    res.redirect(
      302,
      googleCallbackHandoff({
        error: providerError,
        code: rawQueryParam(req.originalUrl, "code"),
        state: rawQueryParam(req.originalUrl, "state"),
        clientOrigin: config.appOrigin,
      }),
    );
  });

  app.post(
    "/api/auth/google/callback",
    asyncRoute(async (req, res) => {
      rateLimit(`login:${req.ip ?? "unknown"}`);
      if (config.google === null) rejectGoogle("google_off");
      const parsed = GoogleCallbackBody.safeParse(req.body);
      if (!parsed.success) rejectGoogle("google_state");
      try {
        const loaded = await loadGoogleCerts();
        const profile = await exchangeGoogleCode({
          code: parsed.data.code,
          verifier: parsed.data.verifier,
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          redirectUri: googleRedirectUri(config),
          certs: loaded.certs,
          googleDate: loaded.date,
        });
        const member = await memberFromGoogle(pool, profile);
        const token = await openSession(pool, member.id);
        setCookie(res, SESSION, token, config, true);
        res.json({ member: publicMember(member) });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error instanceof GoogleAccountConflict || isDuplicate(error)) {
          log.warn("google_signin_failed", { reason: "google_conflict", detail: null });
          rejectGoogle("google_conflict");
        }
        const code = googleSignInFailure(error);
        if (code === null) throw error;
        log.warn("google_signin_failed", { reason: code, detail: null });
        rejectGoogle(code);
      }
    }),
  );

  app.post(
    "/api/auth/logout",
    asyncRoute(async (req, res) => {
      const token = cookiesOf(req)[SESSION];
      if (token !== undefined) await closeSession(pool, token);
      clearCookie(res, SESSION, config);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/payments/mpesa/stk",
    asyncRoute(async (req, res) => {
      const parsed = StkCallbackBody.safeParse(req.body);
      if (!parsed.success) {
        log.warn("mpesa_callback_invalid", { channel: "stk" });
        res.json({ ResultCode: 0, ResultDesc: "Accepted" });
        return;
      }
      const callback = parsed.data.Body.stkCallback;
      const receipt = callback.ResultCode === 0 ? receiptFromStk(parsed.data) : null;
      await applyDarajaResult(pool, callback.CheckoutRequestID, callback.ResultCode, receipt);
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }),
  );

  app.post(
    "/api/payments/mpesa/b2c",
    asyncRoute(async (req, res) => {
      const parsed = B2cResultBody.safeParse(req.body);
      if (!parsed.success) {
        log.warn("mpesa_callback_invalid", { channel: "b2c" });
        res.json({ ResultCode: 0, ResultDesc: "Accepted" });
        return;
      }
      const result = parsed.data.Result;
      const match = result.ConversationID ?? result.OriginatorConversationID;
      if (match !== undefined) {
        const receipt = result.ResultCode === 0 ? receiptFromB2c(parsed.data) : null;
        await applyDarajaResult(pool, match, result.ResultCode, receipt);
      }
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }),
  );

  app.post(
    "/api/payments/mpesa/b2c-timeout",
    asyncRoute(async (req, res) => {
      const body: unknown = req.body;
      const conversation =
        typeof body === "object" && body !== null && "Result" in body && typeof body.Result === "object" && body.Result !== null
          ? "ConversationID" in body.Result && typeof body.Result.ConversationID === "string"
            ? body.Result.ConversationID
            : "OriginatorConversationID" in body.Result && typeof body.Result.OriginatorConversationID === "string"
              ? body.Result.OriginatorConversationID
              : null
          : null;
      if (conversation !== null && conversation.length > 0 && conversation.length <= 80) {
        await applyDarajaResult(pool, conversation, 1, null);
      }
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }),
  );

  registerDeskRoutes(app, pool, config, rails);

  app.use((req, _res, next) => {
    if (req.path.startsWith("/api/desk")) {
      next();
      return;
    }
    void (async () => {
      const token = cookiesOf(req)[SESSION];
      if (token === undefined) {
        next(new HttpError(401, "unauthenticated", "Sign in to continue."));
        return;
      }
      const member = await memberFromToken(pool, token);
      if (member === null) {
        next(new HttpError(401, "unauthenticated", "Sign in to continue."));
        return;
      }
      (req as Authed).member = member;
      next();
    })().catch(next);
  });

  registerMemberLoanRoutes(app, pool, mustMember);

  app.get(
    "/api/me",
    asyncRoute(async (req, res) => {
      const member = mustMember(req);
      const home = await homeFor(pool, member.id);
      res.json({ member: publicMember(member), claimCents: home.you.claimCents });
    }),
  );

  app.get(
    "/api/home",
    asyncRoute(async (req, res) => {
      const member = mustMember(req);
      const home = await homeFor(pool, member.id);
      const recent = await activityFor(pool, null, 8);
      res.json({ ...home, recent });
    }),
  );

  app.get(
    "/api/members",
    asyncRoute(async (_req, res) => {
      const members = await listMembers(pool);
      res.json({ members: members.map(publicMember) });
    }),
  );

  app.get(
    "/api/activity",
    asyncRoute(async (req, res) => {
      const member = mustMember(req);
      const scope = req.query["scope"] === "me" ? member.id : null;
      const lines = await activityFor(pool, scope, 40);
      res.json({ lines });
    }),
  );

  app.post(
    "/api/payments",
    asyncRoute(async (req, res) => {
      const member = mustMember(req);
      const body = PaymentBody.parse(req.body);
      const phone = body.phone === undefined ? null : kenyanMsisdn(body.phone);
      if ((body.kind === "deposit" || body.kind === "withdraw") && phone === null) {
        throw new HttpError(422, "bad_phone", "Enter the nine digits after +254.");
      }
      const payment = await startPayment(pool, rails, {
        memberId: member.id,
        kind: body.kind,
        amountCents: body.amountCents,
        idempotencyKey: body.idempotencyKey,
        phone,
        toMemberId: body.toMemberId ?? null,
      });
      res.status(payment.status === "succeeded" ? 201 : 202).json(payment);
    }),
  );

  app.post(
    "/api/payments/:id/check",
    asyncRoute(async (req, res) => {
      const member = mustMember(req);
      const id = req.params["id"];
      if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) {
        throw new HttpError(404, "unknown_payment", "That receipt is not on your activity.");
      }
      res.json(await checkPayment(pool, rails, id, member.id));
    }),
  );

  app.get(
    "/api/payments/:id",
    asyncRoute(async (req, res) => {
      const member = mustMember(req);
      const id = req.params["id"];
      if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) {
        throw new HttpError(404, "unknown_payment", "That receipt is not on your activity.");
      }
      res.json(await receiptFor(pool, id, member.id));
    }),
  );

  app.get(
    "/api/payments/:id/receipt.pdf",
    asyncRoute(async (req, res) => {
      const member = mustMember(req);
      const id = req.params["id"];
      if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) {
        throw new HttpError(404, "unknown_payment", "That receipt is not on your activity.");
      }
      const file = await receiptFile(pool, id, member.id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="pesamatters-receipt.pdf"');
      res.setHeader("Cache-Control", "private, no-store");
      res.send(file);
    }),
  );

  app.get(
    "/api/ledger",
    asyncRoute(async (_req, res) => {
      const blocks = await listBlocks(pool);
      res.json({ blocks });
    }),
  );

  app.get(
    "/api/ledger/verify",
    asyncRoute(async (_req, res) => {
      const result = await verifyStoredChain(pool);
      res.status(result.ok ? 200 : 409).json(result);
    }),
  );

  app.get(
    "/api/symbols",
    asyncRoute(async (req, res) => {
      mustMember(req);
      const symbols = await nseShares();
      res.json({ symbols });
    }),
  );

  app.get(
    "/api/quotes/:symbol",
    asyncRoute(async (req, res) => {
      mustMember(req);
      const symbol = req.params["symbol"];
      if (typeof symbol !== "string") {
        throw new HttpError(422, "bad_symbol", "Use the NSE ticker, like SCOM.");
      }
      const quote = await loadQuote(quotes, symbol, false);
      const latest = quote.closes[quote.closes.length - 1];
      const prior = quote.closes.length >= 2 ? quote.closes[quote.closes.length - 2] : undefined;
      if (latest === undefined) {
        throw new HttpError(404, "unknown_symbol", "That ticker has no published close.");
      }
      res.json({
        symbol: quote.symbol,
        name: quote.name,
        closeCents: latest.closeCents,
        closeSession: latest.sessionDate,
        priorCloseCents: prior?.closeCents ?? null,
        priorSession: prior?.sessionDate ?? null,
        dayChangeBps: prior === undefined ? null : dayChangeBps(prior.closeCents, latest.closeCents),
        listedCloseCents: quote.listedCloseCents,
        fxKesPerUsd: quote.fxKesPerUsd,
      });
    }),
  );

  app.get(
    "/api/investments",
    asyncRoute(async (_req, res) => {
      res.json({ investments: await listInvestments(pool) });
    }),
  );

  app.get(
    "/api/investments/:id",
    asyncRoute(async (req, res) => {
      const id = req.params["id"];
      if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) {
        throw new HttpError(404, "not_found", "That investment is not on the books.");
      }
      const investment = await getInvestment(pool, id);
      if (investment === null) {
        throw new HttpError(404, "not_found", "That investment is not on the books.");
      }
      res.json({
        investment,
        brokerage: {
          venue: "Kingdom Securities",
          mode: "sandbox",
          liveOrders: false,
          note: "Live Kingdom Securities orders are off. This app does not collect or store broker credentials.",
        },
      });
    }),
  );

  app.post(
    "/api/investments",
    asyncRoute(async (req, res) => {
      const member = mustMember(req);
      const body = InvestBody.parse(req.body);
      const unitsMicro = Math.round(body.units * 1_000_000);
      if (!Number.isInteger(unitsMicro) || unitsMicro <= 0) {
        throw new HttpError(422, "bad_units", "Enter a whole or decimal unit count the pot can hold.");
      }
      const quote = await loadQuote(quotes, body.symbol, true);
      const latest = quote.closes[quote.closes.length - 1];
      const prior = quote.closes.length >= 2 ? quote.closes[quote.closes.length - 2] : undefined;
      if (latest === undefined) {
        throw new HttpError(404, "unknown_symbol", "That ticker has no published close.");
      }
      const id = randomBytes(16).toString("hex");
      const block = await appendEntry(pool, "invest", {
        investmentId: id,
        memberId: member.id,
        symbol: quote.symbol,
        name: body.name ?? quote.name,
        unitsMicro,
        priceCents: latest.closeCents,
        sessionDate: latest.sessionDate,
        priorCloseCents: prior?.closeCents ?? null,
        priorSession: prior?.sessionDate ?? null,
      });
      res.status(201).json({ id, blockId: block.id });
    }),
  );

  app.get("/api/brokerage", (_req, res) => {
    res.json({
      venue: "Kingdom Securities",
      mode: "sandbox",
      liveOrders: false,
      note: "Credentials are not accepted here. A live adapter needs its own reviewed secret, outside this app's database.",
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof PaymentError || error instanceof LoanError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof MoneyError) {
      const status = error.code === "unknown_member" || error.code === "unknown_investment" ? 404 : 422;
      res.status(status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(422).json({
        error: { code: "invalid_body", message: "Check the fields and try again." },
      });
      return;
    }
    log.error("request_failed", { name: error instanceof Error ? error.name : "unknown" });
    res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Try again." } });
  });

  return app;
}

async function loadQuote(quotes: QuoteSource, symbol: string, fresh: boolean): Promise<CloseQuote> {
  try {
    return await quotes.load(symbol, nairobiDate(new Date()), fresh);
  } catch (error) {
    if (error instanceof QuoteError) {
      const status = error.code === "bad_symbol" ? 422 : error.code === "unknown_symbol" ? 404 : 502;
      throw new HttpError(status, error.code, error.message);
    }
    throw error;
  }
}

function mustMember(req: Request): Member {
  const member = (req as Authed).member;
  if (member === undefined) {
    throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  }
  return member;
}

function publicMember(member: Member): { id: string; name: string; email: string; createdAt: string } {
  return { id: member.id, name: member.name, email: member.email, createdAt: member.createdAt };
}

function googleRedirectUri(config: AppConfig): string {
  return `${config.appOrigin}/api/auth/google/callback`;
}

function rejectGoogle(code: string): never {
  const known = GOOGLE_FAIL[code] ?? GOOGLE_FAIL["google"];
  if (known === undefined) {
    throw new HttpError(502, "google", "Google sign-in did not finish. Try again.");
  }
  const safeCode = Object.prototype.hasOwnProperty.call(GOOGLE_FAIL, code) ? code : "google";
  throw new HttpError(known.status, safeCode, known.message);
}

function isDuplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  );
}
