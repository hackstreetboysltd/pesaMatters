import { z } from "zod";

function emptyAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const Env = z.object({
  DATABASE_URL: z.string().min(1).max(500),
  SEED_PASSWORD: z.string().min(10).max(200),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  APP_ORIGIN: z.string().url().max(200),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  GOOGLE_CLIENT_ID: z.preprocess(emptyAsUnset, z.string().min(10).max(200).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(emptyAsUnset, z.string().min(10).max(200).optional()),
  MPESA_MODE: z.enum(["mock", "live"]).default("mock"),
  MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_CONSUMER_KEY: z.preprocess(emptyAsUnset, z.string().min(8).max(200).optional()),
  MPESA_CONSUMER_SECRET: z.preprocess(emptyAsUnset, z.string().min(8).max(200).optional()),
  MPESA_SHORTCODE: z.preprocess(emptyAsUnset, z.string().regex(/^\d{5,7}$/).optional()),
  /** Coop (or other) paybill account reference. Daraja AccountReference max is 12 chars. */
  MPESA_ACCOUNT_NUMBER: z.preprocess(emptyAsUnset, z.string().regex(/^[A-Za-z0-9]{1,12}$/).optional()),
  MPESA_PASSKEY: z.preprocess(emptyAsUnset, z.string().min(8).max(200).optional()),
  MPESA_CALLBACK_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  MPESA_INITIATOR_NAME: z.preprocess(emptyAsUnset, z.string().min(1).max(80).optional()),
  MPESA_SECURITY_CREDENTIAL: z.preprocess(emptyAsUnset, z.string().min(8).max(2000).optional()),
  MPESA_B2C_SHORTCODE: z.preprocess(emptyAsUnset, z.string().regex(/^\d{5,7}$/).optional()),
  MPESA_B2C_RESULT_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  MPESA_B2C_TIMEOUT_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  /** Comma-separated emails that may Google-sign into admin (pre-provisioned admins rows). */
  ADMIN_GOOGLE_EMAILS: z.preprocess(emptyAsUnset, z.string().max(2000).optional()),
  UPSTASH_REDIS_REST_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(emptyAsUnset, z.string().min(8).max(500).optional()),
  // Vercel Marketplace Upstash / KV names
  KV_REST_API_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  KV_REST_API_TOKEN: z.preprocess(emptyAsUnset, z.string().min(8).max(500).optional()),
  CRON_SECRET: z.preprocess(emptyAsUnset, z.string().min(16).max(200).optional()),
});

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
};

export type MpesaLive = {
  mode: "live";
  env: "sandbox" | "production";
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  /** Paybill Account Reference (e.g. Coop Bank account number). */
  accountNumber: string;
  passkey: string;
  callbackUrl: string;
  b2c: {
    initiatorName: string;
    securityCredential: string;
    shortcode: string;
    resultUrl: string;
    timeoutUrl: string;
  } | null;
};

export type MpesaConfig = { mode: "mock" } | MpesaLive;

export type AppConfig = {
  databaseUrl: string;
  seedPassword: string;
  port: number;
  appOrigin: string;
  cookieSecure: boolean;
  google: GoogleConfig | null;
  mpesa: MpesaConfig;
  adminGoogleEmails: string[];
  upstashUrl: string | null;
  upstashToken: string | null;
  cronSecret: string | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "env";
    throw new Error(`Invalid configuration: ${path}`);
  }
  const clientId = parsed.data.GOOGLE_CLIENT_ID;
  const clientSecret = parsed.data.GOOGLE_CLIENT_SECRET;
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    throw new Error("Invalid configuration: GOOGLE_CLIENT_ID");
  }
  const adminGoogleEmails = parseAdminGoogleEmails(parsed.data.ADMIN_GOOGLE_EMAILS);
  const upstashUrl = parsed.data.UPSTASH_REDIS_REST_URL ?? parsed.data.KV_REST_API_URL ?? null;
  const upstashToken = parsed.data.UPSTASH_REDIS_REST_TOKEN ?? parsed.data.KV_REST_API_TOKEN ?? null;
  if ((upstashUrl === null) !== (upstashToken === null)) {
    throw new Error("Invalid configuration: UPSTASH_REDIS_REST_URL");
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    seedPassword: parsed.data.SEED_PASSWORD,
    port: parsed.data.PORT,
    appOrigin: parsed.data.APP_ORIGIN,
    cookieSecure: parsed.data.COOKIE_SECURE === "true",
    google: clientId !== undefined && clientSecret !== undefined ? { clientId, clientSecret } : null,
    mpesa: mpesaFrom(parsed.data),
    adminGoogleEmails,
    upstashUrl,
    upstashToken,
    cronSecret: parsed.data.CRON_SECRET ?? null,
  };
}

/** Split and normalize admin Google allowlist emails. Invalid entries are dropped. */
export function parseAdminGoogleEmails(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim().length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email.length === 0 || email.length > 254 || !email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function mpesaFrom(data: z.infer<typeof Env>): MpesaConfig {
  if (data.MPESA_MODE === "mock") return { mode: "mock" };
  const key = data.MPESA_CONSUMER_KEY;
  const secret = data.MPESA_CONSUMER_SECRET;
  const shortcode = data.MPESA_SHORTCODE;
  const accountNumber = data.MPESA_ACCOUNT_NUMBER;
  const passkey = data.MPESA_PASSKEY;
  const callbackUrl = data.MPESA_CALLBACK_URL;
  if (
    key === undefined ||
    secret === undefined ||
    shortcode === undefined ||
    accountNumber === undefined ||
    passkey === undefined ||
    callbackUrl === undefined
  ) {
    throw new Error("Invalid configuration: MPESA_CONSUMER_KEY");
  }
  if (!callbackUrl.startsWith("https://")) {
    throw new Error("Invalid configuration: MPESA_CALLBACK_URL");
  }
  const initiator = data.MPESA_INITIATOR_NAME;
  const credential = data.MPESA_SECURITY_CREDENTIAL;
  const resultUrl = data.MPESA_B2C_RESULT_URL;
  const timeoutUrl = data.MPESA_B2C_TIMEOUT_URL;
  const b2cShort = data.MPESA_B2C_SHORTCODE ?? shortcode;
  const b2cReady = initiator !== undefined && credential !== undefined && resultUrl !== undefined && timeoutUrl !== undefined;
  if ((initiator !== undefined || credential !== undefined || resultUrl !== undefined || timeoutUrl !== undefined) && !b2cReady) {
    throw new Error("Invalid configuration: MPESA_INITIATOR_NAME");
  }
  if (b2cReady && resultUrl !== undefined && timeoutUrl !== undefined && (!resultUrl.startsWith("https://") || !timeoutUrl.startsWith("https://"))) {
    throw new Error("Invalid configuration: MPESA_B2C_RESULT_URL");
  }
  return {
    mode: "live",
    env: data.MPESA_ENV,
    consumerKey: key,
    consumerSecret: secret,
    shortcode,
    accountNumber,
    passkey,
    callbackUrl,
    b2c:
      b2cReady && initiator !== undefined && credential !== undefined && resultUrl !== undefined && timeoutUrl !== undefined
        ? { initiatorName: initiator, securityCredential: credential, shortcode: b2cShort, resultUrl, timeoutUrl }
        : null,
  };
}
