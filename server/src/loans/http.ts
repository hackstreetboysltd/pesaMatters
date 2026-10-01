import type { NextFunction, Request, Response } from "express";
import type { Express } from "express";
import { z } from "zod";
import type { AppConfig } from "../config.ts";
import type { Db } from "../db.ts";
import type { Rails } from "../mpesa/client.ts";
import { kenyanMsisdn } from "../mpesa/phone.ts";
import {
  adminFromToken,
  appraise,
  closeDeskSession,
  capacityFor,
  createApplication,
  decide,
  disburse,
  getApplication,
  inviteGuarantor,
  listQueue,
  LoanError,
  mine,
  openDeskSession,
  respondToGuarantee,
  searchMembers,
} from "./service.ts";

const DESK = "hs_desk";

const Id = z.string().regex(/^[a-f0-9]{32}$/);
const Cents = z.number().int().positive().max(100_000_000_00);

const ApplyBody = z.object({
  productCode: z.string().trim().min(1).max(16),
  amountCents: Cents,
  termCount: z.number().int().min(1).max(36),
  purpose: z.string().trim().min(5).max(500),
  phone: z.string().min(9).max(20),
  guarantors: z
    .array(z.object({ memberId: Id, amountCents: Cents }))
    .max(6),
});

const InviteBody = z.object({ memberId: Id, amountCents: Cents });
const RespondBody = z.object({ accept: z.boolean() });
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
const LoginBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
});

type DeskReq = Request & { admin?: { id: string; name: string; email: string } };

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

export function registerDeskRoutes(app: Express, pool: Db, config: AppConfig, rails: Rails): void {
  app.post(
    "/api/desk/login",
    asyncRoute(async (req, res) => {
      const body = LoginBody.parse(req.body);
      const opened = await openDeskSession(pool, body.email.toLowerCase(), body.password);
      if (opened === null) throw new LoanError(401, "bad_login", "That email or password is wrong.");
      setCookie(res, DESK, opened.token, config, 60 * 60 * 12);
      res.json({ admin: opened.admin });
    }),
  );

  app.post(
    "/api/desk/logout",
    asyncRoute(async (req, res) => {
      const token = cookiesOf(req)[DESK];
      if (token !== undefined) await closeDeskSession(pool, token);
      clearCookie(res, DESK, config);
      res.json({ ok: true });
    }),
  );

  app.use("/api/desk", (req, _res, next) => {
    void (async () => {
      const token = cookiesOf(req)[DESK];
      if (token === undefined) throw new LoanError(401, "unauthenticated", "Sign in to the desk.");
      const admin = await adminFromToken(pool, token);
      if (admin === null) throw new LoanError(401, "unauthenticated", "Sign in to the desk.");
      (req as DeskReq).admin = admin;
      next();
    })().catch(next);
  });

  app.get(
    "/api/desk/me",
    asyncRoute(async (req, res) => {
      res.json({ admin: (req as DeskReq).admin });
    }),
  );

  app.get(
    "/api/desk/loans",
    asyncRoute(async (_req, res) => {
      res.json({ applications: await listQueue(pool) });
    }),
  );

  app.get(
    "/api/desk/loans/:id",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const application = await getApplication(pool, id);
      res.json({ application, capacity: await capacityFor(pool, application.memberId) });
    }),
  );

  app.post(
    "/api/desk/loans/:id/appraise",
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
    "/api/desk/loans/:id/decide",
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
    "/api/desk/loans/:id/disburse",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const application = await disburse(pool, rails, id);
      res.json({ application });
    }),
  );
}

export function registerMemberLoanRoutes(
  app: Express,
  pool: Db,
  memberOf: (req: Request) => { id: string },
): void {
  app.get(
    "/api/loans/mine",
    asyncRoute(async (req, res) => {
      res.json(await mine(pool, memberOf(req).id));
    }),
  );

  app.get(
    "/api/loans/members",
    asyncRoute(async (req, res) => {
      const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
      res.json({ members: await searchMembers(pool, memberOf(req).id, q) });
    }),
  );

  app.post(
    "/api/loans/applications",
    asyncRoute(async (req, res) => {
      const body = ApplyBody.parse(req.body);
      const phone = kenyanMsisdn(body.phone);
      if (phone === null) throw new LoanError(422, "bad_phone", "Enter the nine digits after +254.");
      const application = await createApplication(pool, memberOf(req).id, { ...body, phone });
      res.status(201).json({ application });
    }),
  );

  app.post(
    "/api/loans/applications/:id/guarantors",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const body = InviteBody.parse(req.body);
      const application = await inviteGuarantor(pool, memberOf(req).id, id, body);
      res.status(201).json({ application });
    }),
  );

  app.post(
    "/api/loans/guarantors/:id/respond",
    asyncRoute(async (req, res) => {
      const id = Id.parse(req.params["id"]);
      const body = RespondBody.parse(req.body);
      await respondToGuarantee(pool, memberOf(req).id, id, body.accept);
      res.json(await mine(pool, memberOf(req).id));
    }),
  );
}
