/** Daraja STK helpers. Timestamps use the Africa/Nairobi clock Safaricom hashes. */

export function darajaTimestamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const take = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${take("year")}${take("month")}${take("day")}${take("hour")}${take("minute")}${take("second")}`;
}

export function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

export function parseAccessToken(json: unknown): { accessToken: string; expiresInSec: number } {
  if (typeof json !== "object" || json === null) throw new Error("mpesa_token_missing");
  const access = "access_token" in json && typeof json.access_token === "string" ? json.access_token : null;
  if (access === null || access.length === 0) throw new Error("mpesa_token_missing");
  const expiresRaw = "expires_in" in json ? json.expires_in : 3599;
  const expiresInSec = typeof expiresRaw === "number" ? expiresRaw : typeof expiresRaw === "string" ? Number(expiresRaw) : 3599;
  return { accessToken: access, expiresInSec: Number.isFinite(expiresInSec) ? expiresInSec : 3599 };
}

export type StkPushParsed = { checkoutRequestId: string; merchantRequestId: string };

export function parseStkPushResponse(json: unknown): StkPushParsed {
  if (typeof json !== "object" || json === null) throw new Error("mpesa_stk_failed");
  const code = "ResponseCode" in json ? String(json.ResponseCode) : "";
  const checkout = "CheckoutRequestID" in json && typeof json.CheckoutRequestID === "string" ? json.CheckoutRequestID : null;
  if (code !== "0" || checkout === null || checkout.length === 0 || checkout.length > 80) {
    throw new Error("mpesa_stk_failed");
  }
  const merchant = "MerchantRequestID" in json && typeof json.MerchantRequestID === "string" ? json.MerchantRequestID.slice(0, 80) : "";
  return { checkoutRequestId: checkout, merchantRequestId: merchant };
}

export type StkQueryParsed = { resultCode: string; resultDesc: string };

export function parseStkQueryResponse(json: unknown): StkQueryParsed {
  if (typeof json !== "object" || json === null) throw new Error("mpesa_stk_query_failed");
  const resultCode = "ResultCode" in json && json.ResultCode !== undefined ? String(json.ResultCode) : "";
  const resultDesc = "ResultDesc" in json && typeof json.ResultDesc === "string" ? json.ResultDesc.slice(0, 400) : "";
  if (resultCode.length === 0) {
    const responseCode = "ResponseCode" in json ? String(json.ResponseCode) : "";
    if (responseCode === "500.001.1001") return { resultCode: "4999", resultDesc: resultDesc.length > 0 ? resultDesc : "processing" };
    throw new Error("mpesa_stk_query_failed");
  }
  return { resultCode, resultDesc };
}

export type B2cParsed = { conversationId: string; originatorConversationId: string };

export function parseB2cResponse(json: unknown): B2cParsed {
  if (typeof json !== "object" || json === null) throw new Error("mpesa_b2c_failed");
  const code = "ResponseCode" in json ? String(json.ResponseCode) : "";
  const conversation = "ConversationID" in json && typeof json.ConversationID === "string" ? json.ConversationID : null;
  if (code !== "0" || conversation === null || conversation.length === 0 || conversation.length > 80) {
    throw new Error("mpesa_b2c_failed");
  }
  const originator =
    "OriginatorConversationID" in json && typeof json.OriginatorConversationID === "string"
      ? json.OriginatorConversationID.slice(0, 80)
      : conversation;
  return { conversationId: conversation, originatorConversationId: originator };
}

export type StkOutcome = "paid" | "pending" | "failed";

/** Map a Daraja ResultCode onto the payment row. 4999 means Safaricom is still waiting. */
export function stkOutcome(resultCode: string): StkOutcome {
  if (resultCode === "0") return "paid";
  if (resultCode === "4999") return "pending";
  return "failed";
}
