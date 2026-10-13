import "dotenv/config";
import { z } from "zod";

const sgDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),

  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]{30,}$/, "doesn't look like a bot token"),
  /** Origin(s) of the deployed Mini App, comma-separated. Used for CORS. */
  WEBAPP_URL: z.string().min(1),
  /** How old an initData payload may be before we reject it. */
  INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
  /** Number of reverse-proxy hops in front of the app (0 = none). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  /** Bootstrap admin whitelist, comma-separated Telegram user IDs. */
  ADMIN_TELEGRAM_IDS: z.string().default(""),

  ZONE_NAME: z.string().default("AP"),
  CAMPAIGN_START: sgDate.default("2026-10-19"),
  CAMPAIGN_END: sgDate.default("2027-02-28"),

  // S3-compatible object storage (Cloudflare R2 by default).
  S3_ENDPOINT: optional, // https://<account_id>.r2.cloudflarestorage.com
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_BUCKET: optional,
  /** Public base URL of the bucket (custom domain or r2.dev). If unset, media URLs are presigned. */
  MEDIA_PUBLIC_BASE_URL: optional,
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}
const env = parsed.data;

function parseAdminIds(raw: string): Set<bigint> {
  const ids = new Set<bigint>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!/^\d+$/.test(part)) throw new Error(`ADMIN_TELEGRAM_IDS: "${part}" is not a numeric Telegram ID`);
    ids.add(BigInt(part));
  }
  return ids;
}

export const config = {
  ...env,
  isProduction: env.NODE_ENV === "production",
  adminTelegramIds: parseAdminIds(env.ADMIN_TELEGRAM_IDS),
  corsOrigins: env.WEBAPP_URL.split(",").map((u) => new URL(u.trim()).origin),
  storage:
    env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET
      ? {
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          bucket: env.S3_BUCKET,
          publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL?.replace(/\/+$/, ""),
        }
      : undefined,
} as const;

export type StorageConfig = NonNullable<typeof config.storage>;
