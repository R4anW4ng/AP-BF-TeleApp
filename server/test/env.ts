/** Environment for the test run. Uses a separate database so tests never touch dev data. */
export const TEST_ENV = {
  NODE_ENV: "test",
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/ap_building_fund_test?schema=public",
  TELEGRAM_BOT_TOKEN: "123456789:TEST-token_abcdefghijklmnopqrstuvwxyz",
  WEBAPP_URL: "https://miniapp.example.org",
  ADMIN_TELEGRAM_IDS: "1000",
  CAMPAIGN_START: "2026-10-19",
  CAMPAIGN_END: "2027-02-28",
  // Never let a developer's real bucket credentials leak into tests.
  S3_ENDPOINT: "",
  S3_ACCESS_KEY_ID: "",
  S3_SECRET_ACCESS_KEY: "",
  S3_BUCKET: "",
} as const;
