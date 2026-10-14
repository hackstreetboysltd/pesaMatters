import type { NextFunction, Request, Response } from "express";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.ts";
import type { Db } from "../db.ts";
import type { Rails } from "../mpesa/client.ts";
import {
  exchangeGoogleCode,
  googleCallbackHandoff,
  googleOAuthRedirectUri,
  googleSignInFailure,
  loadGoogleCerts,
  rawQueryParam,
} from "../google.ts";
import { log } from "../logger.ts";
import {
  AdminGoogleError,
  adminFromGoogle,
  adminFromToken,
  appraise,
  capacityFor,
  closeAdminSession,
  decide,
  disburse,
  getApplication,
  openAdminSession,
  type Admin,
  LoanError,
} from "../loans/service.ts";
import {
  createProduct,
  ProductError,
  updateProduct,
  type ProductInput,
} from "../loans/products.ts";
import { MoneyError } from "../money.ts";
import { QuoteError, dayChangeBps, nairobiDate, type QuoteSource } from "../quotes.ts";
import { realNowDate } from "../realTime.ts";
import { appendEntry, getInvestment, listBlocks, verifyStoredChain } from "../store.ts";
import { nseShares } from "../symbols.ts";
import { approveWithdraw, PaymentError, rejectWithdraw } from "../payments.ts";
import {
  loadAdminInvestments,
  loadAdminLoans,
  loadGroup,
  loadOverview,
  loadPayments,
  loadProducts,
  loadTreasury,
} from "./service.ts";

const ADMIN_COOKIE = "hs_admin";

const Id = z.string().regex(/^[a-f0-9]{32}$/);
const Cents = z.number().int().positive().max(100_000_000_00);

const GoogleCallbackBody = z.object({
  code: z.string().min(8).max(8192),
  verifier: z.string().regex(/^[A-Za-z0-9\-._~]{43,128}$/),
});

const AppraiseBody = z.object({
  recommendedCents: Cents,
  notes: z.string().trim().min(10).max(2000),
  riskRating: z.enum(["low", "medium", "high"]).optional(),
});

const DecideBody = z
  .object({
    decision: z.enum(["approve", "reject"]),
    amountCents: Cents.optional(),
    termCount: z.number().int().min(1).max(36).optional(),
    notes: z.string().trim().min(5).max(1000),
  })
  .refine((value) => value.decision === "reject" || value.amountCents !== undefined, {
    message: "State the approved amount",
  });

const ProductFields = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,15}$/),
  name: z.string().trim().min(2).max(80),
  interestPercent: z.number().int().min(0).max(100),
  termMin: z.number().int().min(1).max(36),
  termMax: z.number().int().min(1).max(36),
  termUnit: z.enum(["weeks", "months"]),
  minimumCents: z.number().int().positive().max(100_000_000_00),
  maximumCents: z.number().int().positive().max(100_000_000_00),
  minimumGuarantors: z.number().int().min(0).max(20),
  coveragePercent: z.number().int().min(0).max(100),
  feePercent: z.number().int().min(0).max(100),
});

const ProductBody = ProductFields.refine((value) => value.termMin <= value.termMax, { message: "term range" })
  .refine((value) => value.minimumCents <= value.maximumCents, { message: "amount range" })
  .refine((value) => value.minimumCents % 100 === 0 && value.maximumCents % 100 === 0, {
    message: "whole shillings",
  });

const ProductPatchBody = ProductFields.omit({ code: true })
  .refine((value) => value.termMin <= value.termMax, { message: "term range" })
  .refine((value) => value.minimumCents <= value.maximumCents, { message: "amount range" })
  .refine((value) => value.minimumCents % 100 === 0 && value.maximumCents % 100 === 0, {
    message: "whole shillings",
  });

const InvestBody = z.object({
  symbol: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(80).optional(),
  units: z.number().positive().max(1_000_000),
});

const GOOGLE_FAIL: Record<string, { status: number; message: string }> = {
  google: { status: 502, message: "Google sign-in did not finish. Try again." },
  google_off: {
    status: 503,
    message: "Google sign-in needs a client id and secret in the server environment.",
  },
  google_state: { status: 400, message: "That sign-in expired. Try Continue with Google again." },
  google_network: { status: 502, message: "Could not reach Google. Check the network or pause the VPN, then try again." },
  google_clock: {
    status: 409,
    message: "This device's clock is wrong. Set the correct date and time, then try again.",
  },
  google_conflict: { status: 409, message: "That Google email is already tied to another admin." },
  google_client: {
    status: 502,
    message: "Google rejected the client secret. Check it in the server environment and restart the API.",
  },
  google_redirect: { status: 502, message: "The Google redirect address does not match this app." },
  email_unverified: { status: 403, message: "That Google account has not verified its email." },
  not_admin: { status: 403, message: "That Google account is not an admin on this pot." },
};

type AdminReq = Request & { admin?: Admin };

type RateLimiter = { limit: (key: string) => Promise<{ success: boolean }> };

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

function setCookie(res: Response, name: string, value: string, config: AppConfig, maxAgeSeconds: number): void {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    "HttpOnly",
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
  setCookie(res, name, "", config, 0);
}

function asyncRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

function adminGoogleRedirectUri(config: AppConfig): string {
  return googleOAuthRedirectUri(config.appOrigin);
}

function rejectGoogle(code: string): never {
  const known = GOOGLE_FAIL[code] ?? GOOGLE_FAIL["google"];
  if (known === undefined) {
    throw new LoanError(502, "google", "Google sign-in did not finish. Try again.");
  }
  const safeCode = Object.prototype.hasOwnProperty.call(GOOGLE_FAIL, code) ? code : "google";
  throw new LoanError(known.status, safeCode, known.message);
}

function isDuplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "ER_DUP_ENTRY" || (error as { code?: string }).code === "23505")
  );
}

async function adminQuote(quotes: QuoteSource, symbol: string, fresh: boolean) {
  try {
    return await quotes.load(symbol, nairobiDate(realNowDate()), fresh);
  } catch (error) {
    if (error instanceof QuoteError) {
      const status = error.code === "bad_symbol" ? 422 : error.code === "unknown_symbol" ? 404 : 502;
      throw new LoanError(status, error.code, error.message);
    }
    throw error;
  }
}

function toProductInput(body: z.infer<typeof ProductBody>): ProductInput {
  return {
    code: body.code,
    name: body.name,
    interestPercent: body.interestPercent,
    termMin: body.termMin,
    termMax: body.termMax,
    termUnit: body.termUnit,
    minimumCents: body.minimumCents,
    maximumCents: body.maximumCents,
    minimumGuarantors: body.minimumGuarantors,
    coveragePercent: body.coveragePercent,
    feePercent: body.feePercent,
  };
}

export function registerAdminRoutes(
  app: Express,
  pool: Db,
  config: AppConfig,
  limiter: RateLimiter,
  rails: Rails,
  quotes: QuoteSource,
): void {
  app.get("/api/admin/auth/google", (_req, res) => {
    if (config.google === null) {
      res.json({ enabled: false });
      return;
    }
    res.json({
      enabled: true,
      clientId: config.google.clientId,
      // Same redirect URI as members — Google Console only needs one entry.
      redirectUri: adminGoogleRedirectUri(config),
    });
  });

  // Legacy path: if anyone still hits the old admin callback URL, hand off like the shared one.
  app.get("/api/admin/auth/google/callback", (req, res) => {
    const providerError = rawQueryParam(req.originalUrl, "error");
    if (providerError !== null) {
      log.warn("admin_google_signin_failed", {
        reason: providerError === "access_denied" ? "google_denied" : "google",
        detail: null,
      });
    }
    res.redirect(
      302,
      googleCallbackHandoff({
        error: providerError,
        code: rawQueryParam(req.originalUrl, "code"),
        state: rawQueryParam(req.originalUrl, "state"),
        clientOrigin: config.appOrigin,
        loginPath: "/admin/login",
      }),
    );
  });

  app.post(
    "/api/admin/auth/google/callback",
    asyncRoute(async (req, res) => {
      const limited = await limiter.limit(`admin-login:${req.ip ?? "unknown"}`);
      if (!limited.success) {
        throw new LoanError(429, "rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.");
      }
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
          redirectUri: adminGoogleRedirectUri(config),
          certs: loaded.certs,
          googleDate: loaded.date,
        });
        const admin = await adminFromGoogle(pool, profile);
        const token = await openAdminSession(pool, admin);
        setCookie(res, ADMIN_COOKIE, token, config, 60 * 60 * 12);
        res.json({ admin });
      } catch (error) {
        if (error instanceof LoanError) throw error;
        if (error instanceof AdminGoogleError) {
          log.warn("admin_google_signin_failed", { reason: error.code, detail: null });
          rejectGoogle(error.code);
        }
        if (isDuplicate(error)) {
          log.warn("admin_google_signin_failed", { reason: "google_conflict", detail: null });
          rejectGoogle("google_conflict");
        }
        const code = googleSignInFailure(error);
        if (code === null) throw error;
        log.warn("admin_google_signin_failed", { reason: code, detail: null });
        rejectGoogle(code);
      }
    }),
  );

  app.post(
    "/api/admin/logout",
    asyncRoute(async (req, res) => {
      const token = cookiesOf(req)[ADMIN_COOKIE];
      if (token !== undefined) await closeAdminSession(pool, token);
      clearCookie(res, ADMIN_COOKIE, config);
      res.json({ ok: true });
    }),
  );

  app.use("/api/admin", (req, _res, next) => {
    if (req.path.startsWith("/auth/")) {
      next();
      return;
    }
    void (async () => {
      const token = cookiesOf(req)[ADMIN_COOKIE];
      if (token === undefined) throw new LoanError(401, "unauthenticated", "Sign in to admin.");
      const admin = await adminFromToken(pool, token);
      if (admin === null) throw new LoanError(401, "unauthenticated", "Sign in to admin.");
      (req as AdminReq).admin = admin;
      next();
    })().catch(next);
  });

  app.get(
    "/api/admin/me",
    asyncRoute(async (req, res) => {
      res.json({ admin: (req as AdminReq).admin });
    }),
  );

  app.get(
    "/api/admin/overview",
    asyncRoute(async (_req, res) => {
      res.json(await loadOverview(pool));
    }),
  );

  app.get(
    "/api/admin/group",
    asyncRoute(async (_req, res) => {
      res.json({ group: await loadGroup(pool) });
    }),
  );

  app.get(
    "/api/admin/treasury",
    asyncRoute(async (_req, res) => {
      res.json(await loadTreasury(pool));
    }),
  );

  app.get(
    "/api/admin/payments",
    asyncRoute(async (req, res) => {
      const raw = typeof req.query["limit"] === "string" ? Number(req.query["limit"]) : 40;
      const limit = Number.isFinite(raw) ? raw : 40;
      res.json({ payments: await loadPayments(pool, limit) });
    }),
  );

  app.post(
    "/api/admin/payments/:id/approve",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      try {
        const payment = await approveWithdraw(pool, rails, id);
        res.json({ payment });
      } catch (error) {
        if (error instanceof PaymentError) {
          throw new LoanError(error.status, error.code, error.message);
        }
        throw error;
      }
    }),
  );

  app.post(
    "/api/admin/payments/:id/reject",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      try {
        const payment = await rejectWithdraw(pool, id);
        res.json({ payment });
      } catch (error) {
        if (error instanceof PaymentError) {
          throw new LoanError(error.status, error.code, error.message);
        }
        throw error;
      }
    }),
  );

  app.get(
    "/api/admin/investments",
    asyncRoute(async (_req, res) => {
      res.json({ investments: await loadAdminInvestments(pool) });
    }),
  );

  app.get(
    "/api/admin/investments/:id",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const investment = await getInvestment(pool, id);
      if (investment === null) throw new LoanError(404, "not_found", "That investment is not on the books.");
      res.json({ investment });
    }),
  );

  app.get(
    "/api/admin/symbols",
    asyncRoute(async (_req, res) => {
      res.json({ symbols: await nseShares() });
    }),
  );

  app.get(
    "/api/admin/quotes/:symbol",
    asyncRoute(async (req, res) => {
      const symbol = req.params["symbol"];
      if (typeof symbol !== "string") {
        throw new LoanError(422, "bad_symbol", "Use the NSE ticker, like SCOM.");
      }
      const quote = await adminQuote(quotes, symbol, false);
      const latest = quote.closes[quote.closes.length - 1];
      const prior = quote.closes.length >= 2 ? quote.closes[quote.closes.length - 2] : undefined;
      if (latest === undefined) {
        throw new LoanError(404, "unknown_symbol", "That ticker has no published close.");
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

  app.post(
    "/api/admin/investments",
    asyncRoute(async (req, res) => {
      const admin = (req as AdminReq).admin;
      if (admin === undefined) throw new LoanError(401, "unauthenticated", "Sign in to admin.");
      const body = InvestBody.parse(req.body);
      const unitsMicro = Math.round(body.units * 1_000_000);
      if (!Number.isInteger(unitsMicro) || unitsMicro <= 0) {
        throw new LoanError(422, "bad_units", "Enter a whole or decimal unit count the pot can hold.");
      }
      const quote = await adminQuote(quotes, body.symbol, true);
      const latest = quote.closes[quote.closes.length - 1];
      const prior = quote.closes.length >= 2 ? quote.closes[quote.closes.length - 2] : undefined;
      if (latest === undefined) {
        throw new LoanError(404, "unknown_symbol", "That ticker has no published close.");
      }
      const id = randomBytes(16).toString("hex");
      try {
        const block = await appendEntry(pool, "invest", {
          investmentId: id,
          memberId: admin.id,
          adminId: admin.id,
          symbol: quote.symbol,
          name: body.name ?? quote.name,
          unitsMicro,
          priceCents: latest.closeCents,
          sessionDate: latest.sessionDate,
          priorCloseCents: prior?.closeCents ?? null,
          priorSession: prior?.sessionDate ?? null,
        });
        res.status(201).json({ id, blockId: block.id });
      } catch (error) {
        if (error instanceof MoneyError) {
          throw new LoanError(422, error.code, error.message);
        }
        throw error;
      }
    }),
  );

  app.get(
    "/api/admin/ledger",
    asyncRoute(async (_req, res) => {
      const blocks = await listBlocks(pool);
      res.json({ blocks });
    }),
  );

  app.get(
    "/api/admin/ledger/verify",
    asyncRoute(async (_req, res) => {
      res.json(await verifyStoredChain(pool));
    }),
  );

  app.get(
    "/api/admin/loans",
    asyncRoute(async (_req, res) => {
      res.json({ applications: await loadAdminLoans(pool) });
    }),
  );

  app.get(
    "/api/admin/loans/:id",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const application = await getApplication(pool, id);
      res.json({ application, capacity: await capacityFor(pool, application.memberId) });
    }),
  );

  app.post(
    "/api/admin/loans/:id/appraise",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const body = AppraiseBody.parse(req.body);
      const application = await appraise(pool, id, {
        recommendedCents: body.recommendedCents,
        notes: body.notes,
        riskRating: body.riskRating ?? null,
      });
      res.json({ application });
    }),
  );

  app.post(
    "/api/admin/loans/:id/decide",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const body = DecideBody.parse(req.body);
      const application = await decide(pool, id, {
        decision: body.decision,
        amountCents: body.amountCents ?? null,
        termCount: body.termCount ?? null,
        notes: body.notes,
      });
      res.json({ application });
    }),
  );

  app.post(
    "/api/admin/loans/:id/disburse",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const application = await disburse(pool, rails, id);
      res.json({ application });
    }),
  );

  app.get(
    "/api/admin/products",
    asyncRoute(async (_req, res) => {
      res.json({ products: await loadProducts(pool) });
    }),
  );

  app.post(
    "/api/admin/products",
    asyncRoute(async (req, res) => {
      const body = ProductBody.parse(req.body);
      try {
        const product = await createProduct(pool, toProductInput(body));
        res.status(201).json({ product });
      } catch (error) {
        if (error instanceof ProductError) {
          throw new LoanError(error.status, error.code, error.message);
        }
        throw error;
      }
    }),
  );

  app.patch(
    "/api/admin/products/:code",
    asyncRoute(async (req, res) => {
      const code = z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z][A-Z0-9]{1,15}$/)
        .parse(req.params["code"]);
      const body = ProductPatchBody.parse(req.body);
      try {
        const product = await updateProduct(pool, code, {
          name: body.name,
          interestPercent: body.interestPercent,
          termMin: body.termMin,
          termMax: body.termMax,
          termUnit: body.termUnit,
          minimumCents: body.minimumCents,
          maximumCents: body.maximumCents,
          minimumGuarantors: body.minimumGuarantors,
          coveragePercent: body.coveragePercent,
          feePercent: body.feePercent,
        });
        res.json({ product });
      } catch (error) {
        if (error instanceof ProductError) {
          throw new LoanError(error.status, error.code, error.message);
        }
        throw error;
      }
    }),
  );
}
