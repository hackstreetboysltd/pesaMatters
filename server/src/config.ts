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
  MPESA_PASSKEY: z.preprocess(emptyAsUnset, z.string().min(8).max(200).optional()),
  MPESA_CALLBACK_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  MPESA_INITIATOR_NAME: z.preprocess(emptyAsUnset, z.string().min(1).max(80).optional()),
  MPESA_SECURITY_CREDENTIAL: z.preprocess(emptyAsUnset, z.string().min(8).max(2000).optional()),
  MPESA_B2C_SHORTCODE: z.preprocess(emptyAsUnset, z.string().regex(/^\d{5,7}$/).optional()),
  MPESA_B2C_RESULT_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  MPESA_B2C_TIMEOUT_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  DESK_EMAIL: z.preprocess(emptyAsUnset, z.string().trim().email().max(254).optional()),
  DESK_PASSWORD: z.preprocess(emptyAsUnset, z.string().min(10).max(200).optional()),
  UPSTASH_REDIS_REST_URL: z.preprocess(emptyAsUnset, z.string().url().max(300).optional()),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(emptyAsUnset, z.string().min(8).max(500).optional()),
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
  deskEmail: string | null;
  deskPassword: string | null;
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
  const deskEmail = parsed.data.DESK_EMAIL?.toLowerCase() ?? null;
  const deskPassword = parsed.data.DESK_PASSWORD ?? null;
  if ((deskEmail === null) !== (deskPassword === null)) {
    throw new Error("Invalid configuration: DESK_EMAIL");
  }
  const upstashUrl = parsed.data.UPSTASH_REDIS_REST_URL ?? null;
  const upstashToken = parsed.data.UPSTASH_REDIS_REST_TOKEN ?? null;
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
    deskEmail,
    deskPassword,
    upstashUrl,
    upstashToken,
    cronSecret: parsed.data.CRON_SECRET ?? null,
  };
}

function mpesaFrom(data: z.infer<typeof Env>): MpesaConfig {
  if (data.MPESA_MODE === "mock") return { mode: "mock" };
  const key = data.MPESA_CONSUMER_KEY;
  const secret = data.MPESA_CONSUMER_SECRET;
  const shortcode = data.MPESA_SHORTCODE;
  const passkey = data.MPESA_PASSKEY;
  const callbackUrl = data.MPESA_CALLBACK_URL;
  if (
    key === undefined ||
    secret === undefined ||
    shortcode === undefined ||
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
    passkey,
    callbackUrl,
    b2c:
      b2cReady && initiator !== undefined && credential !== undefined && resultUrl !== undefined && timeoutUrl !== undefined
        ? { initiatorName: initiator, securityCredential: credential, shortcode: b2cShort, resultUrl, timeoutUrl }
        : null,
  };
}
