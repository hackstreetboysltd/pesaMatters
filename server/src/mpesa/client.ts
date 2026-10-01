import type { MpesaLive } from "../config.ts";
import {
  darajaPassword,
  darajaTimestamp,
  parseAccessToken,
  parseB2cResponse,
  parseStkPushResponse,
  parseStkQueryResponse,
  type B2cParsed,
  type StkPushParsed,
  type StkQueryParsed,
} from "./daraja.ts";

export type StkPushInput = { phone: string; amountKsh: number; accountRef: string };
export type B2cInput = { phone: string; amountKsh: number; accountRef: string };

export type Rails = {
  mode: "mock" | "live";
  stkPush: (input: StkPushInput) => Promise<StkPushParsed>;
  stkQuery: (checkoutRequestId: string) => Promise<StkQueryParsed>;
  b2c: (input: B2cInput) => Promise<B2cParsed>;
};

export function mockRails(): Rails {
  return {
    mode: "mock",
    async stkPush(input: StkPushInput): Promise<StkPushParsed> {
      const id = `ws_CO_${input.accountRef}`;
      return { checkoutRequestId: id, merchantRequestId: `m-${input.accountRef}`.slice(0, 80) };
    },
    async stkQuery(checkoutRequestId: string): Promise<StkQueryParsed> {
      return { resultCode: "0", resultDesc: `mock:${checkoutRequestId.slice(0, 8)}` };
    },
    async b2c(input: B2cInput): Promise<B2cParsed> {
      const id = `b2c-${input.accountRef}`;
      return { conversationId: id, originatorConversationId: `o-${input.accountRef}`.slice(0, 80) };
    },
  };
}

function baseUrl(env: "sandbox" | "production"): string {
  return env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function liveRails(creds: MpesaLive): Rails {
  let cached: { token: string; expMs: number } | undefined;

  async function accessToken(): Promise<string> {
    if (cached !== undefined && Date.now() < cached.expMs) return cached.token;
    const tokenRes = await fetch(`${baseUrl(creds.env)}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const tokenJson = await readJson(tokenRes);
    if (!tokenRes.ok) throw new Error("mpesa_token_failed");
    const parsed = parseAccessToken(tokenJson);
    cached = { token: parsed.accessToken, expMs: Date.now() + Math.max(30, parsed.expiresInSec - 60) * 1000 };
    return parsed.accessToken;
  }

  function signedBody(): { password: string; timestamp: string } {
    const timestamp = darajaTimestamp();
    return { timestamp, password: darajaPassword(creds.shortcode, creds.passkey, timestamp) };
  }

  return {
    mode: "live",
    async stkPush(input: StkPushInput): Promise<StkPushParsed> {
      const token = await accessToken();
      const { password, timestamp } = signedBody();
      const stkRes = await fetch(`${baseUrl(creds.env)}/mpesa/stkpush/v1/processrequest`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: creds.shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: input.amountKsh,
          PartyA: input.phone,
          PartyB: creds.shortcode,
          PhoneNumber: input.phone,
          CallBackURL: creds.callbackUrl,
          AccountReference: input.accountRef.slice(0, 12),
          TransactionDesc: "PesaMatters",
        }),
        signal: AbortSignal.timeout(20_000),
      });
      return parseStkPushResponse(await readJson(stkRes));
    },
    async stkQuery(checkoutRequestId: string): Promise<StkQueryParsed> {
      const token = await accessToken();
      const { password, timestamp } = signedBody();
      const qRes = await fetch(`${baseUrl(creds.env)}/mpesa/stkpushquery/v1/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: creds.shortcode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: checkoutRequestId,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      return parseStkQueryResponse(await readJson(qRes));
    },
    async b2c(input: B2cInput): Promise<B2cParsed> {
      if (creds.b2c === null) throw new Error("mpesa_b2c_unconfigured");
      const token = await accessToken();
      const b2cRes = await fetch(`${baseUrl(creds.env)}/mpesa/b2c/v1/paymentrequest`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          InitiatorName: creds.b2c.initiatorName,
          SecurityCredential: creds.b2c.securityCredential,
          CommandID: "BusinessPayment",
          Amount: input.amountKsh,
          PartyA: creds.b2c.shortcode,
          PartyB: input.phone,
          Remarks: "PesaMatters",
          QueueTimeOutURL: creds.b2c.timeoutUrl,
          ResultURL: creds.b2c.resultUrl,
          Occasion: input.accountRef.slice(0, 12),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      return parseB2cResponse(await readJson(b2cRes));
    },
  };
}
