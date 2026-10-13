/**
 * Print an `Authorization` header with correctly signed initData, for calling
 * the API with curl during local development (outside Telegram).
 *
 *   npm run sign-init-data -- 123456789 "Grace"
 *   curl -H "Authorization: $(npm run -s sign-init-data -- 123456789)" localhost:3000/api/me
 *
 * It signs with your own TELEGRAM_BOT_TOKEN, so it only works against your own server.
 */
import { config } from "../src/config.js";
import { signInitData } from "../src/lib/telegramInitData.js";

if (config.isProduction) {
  console.error("Refusing to run with NODE_ENV=production.");
  process.exit(1);
}

const [id = "123456789", firstName = "Dev"] = process.argv.slice(2);
if (!/^\d+$/.test(id)) {
  console.error("Usage: sign-init-data <telegramUserId> [firstName]");
  process.exit(1);
}

const initData = signInitData({ user: { id: Number(id), first_name: firstName } }, config.TELEGRAM_BOT_TOKEN);
console.log(`tma ${initData}`);
