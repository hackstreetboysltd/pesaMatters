import type { NextFunction, Request, Response } from "express";
import type { Express } from "express";
import { z } from "zod";
import type { Db } from "../db.ts";
import { kenyanMsisdn } from "../mpesa/phone.ts";
import {
  createApplication,
  inviteGuarantor,
  LoanError,
  mine,
  respondToGuarantee,
  searchMembers,
} from "./service.ts";

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

function asyncRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
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
