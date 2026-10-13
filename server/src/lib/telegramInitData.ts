import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Telegram Mini App `initData` validation.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   data_check_string = every field except `hash`, sorted by key, as "key=value", joined by "\n"
 *   secret_key        = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   expected_hash     = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 *
 * The client must send the RAW `initData` string (Telegram.WebApp.initData),
 * never `initDataUnsafe`, which is an unsigned parsed copy anyone can forge.
 */

const TelegramUserSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  photo_url: z.string().optional(),
  is_bot: z.boolean().optional(),
  is_premium: z.boolean().optional(),
  allows_write_to_pm: z.boolean().optional(),
});

export type TelegramUser = z.infer<typeof TelegramUserSchema>;

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: Date;
  queryId?: string;
  startParam?: string;
  chatType?: string;
}

export type InitDataErrorCode = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "NO_USER";

export class InitDataError extends Error {
  constructor(
    public readonly code: InitDataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InitDataError";
  }
}

export interface ValidateOptions {
  /** Reject payloads whose auth_date is older than this. */
  maxAgeSeconds: number;
  /** Injectable clock for tests. */
  now?: Date;
}

/** Allow a little clock drift between Telegram and this server. */
const MAX_FUTURE_SKEW_SECONDS = 60;
/** Anything larger is not a real initData payload. */
const MAX_INIT_DATA_LENGTH = 8192;

const secretKeyCache = new Map<string, Buffer>();

function secretKeyFor(botToken: string): Buffer {
  let key = secretKeyCache.get(botToken);
  if (!key) {
    key = createHmac("sha256", "WebAppData").update(botToken).digest();
    secretKeyCache.set(botToken, key);
  }
  return key;
}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function sign(params: URLSearchParams, botToken: string): string {
  return createHmac("sha256", secretKeyFor(botToken)).update(dataCheckString(params)).digest("hex");
}

export function validateInitData(
  initData: string,
  botToken: string,
  { maxAgeSeconds, now = new Date() }: ValidateOptions,
): ValidatedInitData {
  if (!initData || initData.length > MAX_INIT_DATA_LENGTH) {
    throw new InitDataError("MALFORMED", "initData is empty or too long");
  }

  const params = new URLSearchParams(initData);

  // Duplicate keys would make the data-check-string ambiguous.
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) {
    throw new InitDataError("MALFORMED", "initData contains duplicate keys");
  }

  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[0-9a-f]{64}$/.test(receivedHash)) {
    throw new InitDataError("MALFORMED", "initData hash is missing or malformed");
  }

  const expected = Buffer.from(sign(params, botToken), "hex");
  const received = Buffer.from(receivedHash, "hex");
  if (!timingSafeEqual(expected, received)) {
    throw new InitDataError("BAD_SIGNATURE", "initData signature mismatch");
  }

  // Only trust the fields below this line: they are covered by the signature.
  const authDateRaw = params.get("auth_date");
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    throw new InitDataError("MALFORMED", "initData auth_date is missing");
  }
  const authDateSeconds = Number(authDateRaw);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (nowSeconds - authDateSeconds > maxAgeSeconds) {
    throw new InitDataError("EXPIRED", "initData has expired; reopen the Mini App");
  }
  if (authDateSeconds - nowSeconds > MAX_FUTURE_SKEW_SECONDS) {
    throw new InitDataError("MALFORMED", "initData auth_date is in the future");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new InitDataError("NO_USER", "initData has no user");
  let user: TelegramUser;
  try {
    user = TelegramUserSchema.parse(JSON.parse(userRaw));
  } catch {
    throw new InitDataError("MALFORMED", "initData user is invalid");
  }

  return {
    user,
    authDate: new Date(authDateSeconds * 1000),
    queryId: params.get("query_id") ?? undefined,
    startParam: params.get("start_param") ?? undefined,
    chatType: params.get("chat_type") ?? undefined,
  };
}

/**
 * Produce a correctly signed initData string. For tests and the local
 * `sign-init-data` dev script only — production initData always comes from Telegram.
 */
export function signInitData(
  fields: { user: TelegramUser; authDate?: Date } & Record<string, unknown>,
  botToken: string,
): string {
  const { user, authDate = new Date(), ...rest } = fields;
  const params = new URLSearchParams();
  params.set("auth_date", String(Math.floor(authDate.getTime() / 1000)));
  params.set("user", JSON.stringify(user));
  for (const [key, value] of Object.entries(rest)) params.set(key, String(value));
  params.set("hash", sign(params, botToken));
  return params.toString();
}
