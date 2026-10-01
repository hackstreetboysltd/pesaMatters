import { z } from "zod";

export const StkCallbackBody = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().max(80),
      CheckoutRequestID: z.string().max(80),
      ResultCode: z.number().int(),
      ResultDesc: z.string().max(400).optional(),
      CallbackMetadata: z
        .object({
          Item: z.array(
            z.object({
              Name: z.string().max(64),
              Value: z.union([z.string().max(64), z.number()]).optional(),
            }),
          ),
        })
        .optional(),
    }),
  }),
});

export function receiptFromStk(body: z.infer<typeof StkCallbackBody>): string | null {
  const items = body.Body.stkCallback.CallbackMetadata?.Item ?? [];
  const rec = items.find((item) => item.Name === "MpesaReceiptNumber");
  if (rec === undefined || rec.Value === undefined) return null;
  const text = String(rec.Value).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  return text.length > 0 ? text : null;
}

export const B2cResultBody = z.object({
  Result: z.object({
    ResultCode: z.number().int(),
    ResultDesc: z.string().max(400).optional(),
    ConversationID: z.string().max(80).optional(),
    OriginatorConversationID: z.string().max(80).optional(),
    TransactionID: z.string().max(32).optional(),
  }),
});

export function receiptFromB2c(body: z.infer<typeof B2cResultBody>): string | null {
  const id = body.Result.TransactionID;
  if (id === undefined) return null;
  const text = id.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  return text.length > 0 ? text : null;
}
