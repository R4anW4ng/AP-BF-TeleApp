# Architecture — AP Building Fund Mini App

## Stack

| Layer      | Choice                                                         |
|------------|----------------------------------------------------------------|
| Frontend   | React + Vite + TypeScript + `@telegram-apps/sdk` (`web/`, Phase 4) |
| Backend    | Node.js + TypeScript + Express (`server/`, Phase 2)            |
| Bot + cron | `node-telegram-bot-api` v2 + `node-cron` v4, same process as the API |
| Database   | **PostgreSQL 16 + Prisma 7** (`server/prisma/schema.prisma`)    |

### Why PostgreSQL over MongoDB

The data is relational: users belong to Cell Groups, posts and prayers belong to
users, points roll up to users and then to Cell Groups. Postgres gives us:

- **Unique constraints that enforce point caps** under concurrent taps (see below).
- **Foreign-key actions** that make "Delete my data" correct by construction
  (`CASCADE` on points and reactions, `SET NULL` on content).
- **`GROUP BY` aggregation** for the Cell Group leaderboard in one query.
- **Multi-row transactions**, so a ledger insert and the `totalPoints` cache never drift apart.

## Repository layout

```
server/
  prisma/schema.prisma        data model
  prisma/migrations/          SQL migrations (committed)
  prisma/seed.ts              Cell Groups AP1–AP4 (+ optional sample content)
  src/index.ts                process entry: HTTP server + bot polling + cron
  src/bot.ts                  /start, /help, /resetpin, block tracking
  src/cron.ts                 Monday 05:00 SGT schedule + catch-up sweep
  src/app.ts                  Express app: helmet, CORS, rate limits, routes
  src/config.ts               zod-validated environment
  src/lib/telegramInitData.ts initData HMAC-SHA256 validation
  src/lib/storage.ts          Cloudflare R2 / S3 client + image processing
  src/lib/privacy.ts          who may see whose real name
  src/lib/time.ts             Singapore-time and campaign-week helpers
  src/lib/pin.ts              scrypt PIN hashing
  src/middleware/             telegramAuth, requireAdmin, rate limits, errors
  src/services/               points (caps, streaks), users (sync, delete), broadcast
  src/routes/                 /api/me, /home, /points, /cell-groups, /uploads
  scripts/sign-init-data.ts   signed auth header for local curl testing
  test/                       vitest: unit + API tests against Postgres
web/                          React Mini App (Phase 4)
docs/                         this file, API.md
```

## Data model

```mermaid
erDiagram
  CellGroup ||--o{ User : "members"
  CellGroup ||--o{ Prayer : "snapshot"
  CellGroup ||--o{ LivingPost : "snapshot"
  User ||--o{ PointTransaction : "earns (CASCADE)"
  User ||--o{ Prayer : "authors (SET NULL)"
  User ||--o{ PrayerComment : "authors (SET NULL)"
  User ||--o{ PrayerReaction : "reacts (CASCADE)"
  User ||--o{ LivingPost : "authors (SET NULL)"
  User ||--o{ Testimony : "admin authors"
  User ||--o{ WeeklyChallenge : "admin authors"
  User ||--o{ MonthlyGoal : "admin authors"
  Prayer ||--o{ PrayerComment : ""
  Prayer ||--o{ PrayerReaction : ""
  LivingPost ||--o{ Media : "photos"
  Testimony ||--o{ Media : "inline images"
  Testimony |o--o| Media : "cover"
```

## Key design decisions

### 1. Points are a ledger; caps are enforced by the database
Every award is a `PointTransaction` row with the unique key
`(userId, type, periodKey, slot)`:

| Trigger            | Points | `periodKey`  | `slot` | Cap                        |
|--------------------|--------|--------------|--------|----------------------------|
| `TITHE`            | 100    | `2026-10`    | `1`    | 1 per SGT month            |
| `MEAL_LOG`         | 5      | `2026-10-13` | `1..3` | 3 per SGT day (15 pts)     |
| `LIVING_POST`      | 10     | `2026-10-13` | `1..2` | 2 per SGT day (20 pts)     |
| `ADMIN_ADJUSTMENT` | ±n     | cuid         | `1`    | one row per adjustment     |

Two concurrent taps cannot both claim the same slot: the loser gets a `P2002`
error and moves to the next slot until the cap. Tested: 8 concurrent meal-log
requests award exactly 3. Posting past the Living-post cap is still allowed; it
just earns no more points that day.

`User.totalPoints` is a cache updated in the same transaction as the insert, so
the individual leaderboard is an indexed `ORDER BY totalPoints DESC`. The CG
leaderboard is `SUM(totalPoints) GROUP BY cellGroupId`.

Point values and caps live in `POINT_RULES` (`src/services/points.ts`), not the
schema, so they can be tuned without a migration. The tithe log is a
declaration that this month's tithe is done. **No amount is ever asked for or stored.**

Streaks count consecutive SGT days with at least one point-earning action, and
are updated in the same SQL statement as the points total.

### 2. "Delete my data" is mostly enforced by foreign keys
`DELETE FROM users WHERE id = ?` in one transaction:

- **PII** (name, username, photo, PIN hash, Telegram ID): gone with the row.
- **Prayers, comments, Living posts**: `authorId → NULL`, so they render as **"Former Member"**.
  The post keeps its own `cellGroupId` snapshot, so CG filters still work.
- **Point ledger**: `CASCADE` deletes it, so the user's points leave the individual
  board **and** their CG total immediately.
- **Reactions**: `CASCADE` (they identify the person).
- **Uploads never attached to a post**: rows and R2 objects deleted.
- **Audit trail**: one `USER_SELF_DELETE` row with no identifying metadata.

The API requires `{"confirm": "DELETE"}` in the body. Covered by `test/api.test.ts`.

### 3. Time is always Singapore time (UTC+8)
Daily caps, streaks, "current week" and monthly goals use SGT calendar days
(`@db.Date` columns plus `periodKey` strings). A `WeeklyChallenge` becomes current
when `now() >= publishAt` (Monday 05:00 SGT = Sunday 21:00 UTC). The Home screen
and the Monday cron both use that rule, so the app shows the new challenge as
soon as the broadcast goes out, with no separate sync step.
`broadcastStartedAt/CompletedAt` make the cron idempotent if the process restarts.

### 4. Testimonies are structured JSON blocks, not HTML
`Testimony.blocks` is an array like `{type: "paragraph" | "heading" | "image" | "quote", ...}`,
validated with zod. The client renders plain React elements, so there is no
`dangerouslySetInnerHTML` and no XSS risk. There are deliberately no comment
or reaction relations on testimonies.

### 5. Admins
`ADMIN_TELEGRAM_IDS` (env) is the bootstrap whitelist: those IDs are forced to
`ADMIN` on every authenticated request. Admins promoted in-app are stored as
`User.role = ADMIN`. Every promotion and content change writes an `AuditLog` row.

### 6. Privacy
- **Private Journal**: `localStorage` only. Nothing about it is in the schema.
- **PIN lock**: stored server-side as a scrypt hash, with an attempt counter and
  lockout, so clearing local storage can't bypass it. Users reset it through the
  bot, which is already Telegram-authenticated.
- **Name display** is decided server-side in `src/lib/privacy.ts`, so the
  client never receives a real name it isn't allowed to see.

  **Individual leaderboard**

  | Stay Anonymous | Show me on boards | Listed? | Name shown                                    |
  |----------------|-------------------|---------|-----------------------------------------------|
  | ON             | (any)             | No      | (points still count toward the CG total)      |
  | OFF            | ON (default)      | Yes     | real name to CG peers, "Anonymous" to others  |
  | OFF            | OFF               | Yes     | real name to everyone                         |

  **Feeds** (Prayer Wall, Living it Out, comments): "Anonymous" if Stay Anonymous
  is ON or the post was marked anonymous, otherwise the real name. Authors always
  see their own name. A deleted author is "Former Member".
- **Cell Group changes**: members pick their CG once. Because CG totals follow
  current membership, later changes go through an admin so points can't be
  moved between teams.

## Security model (Phase 2)

1. **Authentication: Telegram `initData`, HMAC-SHA256.** Every `/api` request
   carries `Authorization: tma <Telegram.WebApp.initData>`. `telegramAuth`
   recomputes the signature: `secret = HMAC_SHA256("WebAppData", BOT_TOKEN)`,
   `hash = HMAC_SHA256(secret, sorted "key=value" lines)`. It compares the hashes
   in constant time, rejects payloads older than `INIT_DATA_MAX_AGE_SECONDS` (or
   dated in the future), duplicate keys and bot accounts. Only then does it load
   the user by the **signed** Telegram ID. `initDataUnsafe` is never used. Tests
   check our signer against an independent implementation written from the
   Telegram docs, and check that a forged `user.id` is rejected.
2. **Authorisation.** The role comes from the database row loaded for the
   request, never from the client. `ADMIN_TELEGRAM_IDS` are promoted
   automatically. `requireAdmin` guards admin routes.
3. **Input.** Every body and query is validated with zod `.strict()` schemas,
   so unknown fields such as `role` are rejected. JSON bodies are capped at 100 kB.
4. **Uploads.** Uploads are authenticated, limited to 10 MB and 30 per hour per
   user, and decoded and **re-encoded to WebP** server-side. Anything that isn't
   a real image is rejected, and all metadata (including **EXIF GPS location**)
   is stripped. Storage keys are random UUIDs.
5. **Transport and headers.** helmet, CORS restricted to `WEBAPP_URL`, and
   `Cache-Control: no-store` on API responses. Auth is a header, not a cookie,
   so there is no CSRF surface.
6. **Abuse.** Per-IP and per-user rate limits (in-memory: use a Redis store if
   you run more than one instance). PIN brute force gets locked out after 5
   wrong attempts for 15 minutes.
7. **Errors.** Errors are returned as `{ error: { code, message } }`. Stack
   traces and database details never reach the client.

## Photo storage (Cloudflare R2)

`src/lib/storage.ts` uses `@aws-sdk/client-s3`, so any S3-compatible bucket
works. For R2:

1. Create a bucket (e.g. `ap-building-fund`).
2. Go to **R2 → Manage API tokens** and create a token with *Object Read & Write*
   scoped to that bucket. Copy the access key ID and secret into `S3_ACCESS_KEY_ID`
   and `S3_SECRET_ACCESS_KEY`.
3. Set `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com` and `S3_REGION=auto`.
4. Either connect a public custom domain (or enable r2.dev) and set
   `MEDIA_PUBLIC_BASE_URL`, or leave it empty to keep the bucket private and
   serve 1-hour presigned URLs.

Without these variables the server still runs; only uploads return 503.

## Bot and Monday broadcast (Phase 3)

The bot runs in the same process as the API (`src/index.ts`) and long-polls
Telegram. If Telegram is unreachable at boot, it retries in the background
while the API keeps serving.

| Command / update | Effect |
|------------------|--------|
| `/start`         | Upserts the user by Telegram ID (`botStartedAt` set, `botBlocked` cleared) and replies with a welcome message and an inline **web_app** button that opens `WEBAPP_URL`. In groups it asks people to message privately. |
| `/help`          | Lists commands, with the app button. |
| `/resetpin`      | Removes the sender's app PIN (forgotten-PIN recovery). |
| `my_chat_member` | Telegram reports block/unblock: sets/clears `botBlocked`. |

### Timezone handling

1. **The schedule.** `cron.ts` registers `0 5 * * 1` with `timezone: "Asia/Singapore"`.
   node-cron evaluates the expression in that zone (via `Intl`), not in the
   host's local time. It fires at Monday 05:00 SGT, which is Sunday 21:00 UTC,
   wherever the server runs. Singapore has no daylight saving, so the instant
   never drifts.
2. **The data.** Inside the job, "this week" and "this month" come from
   `lib/time.ts`, which applies the fixed +08:00 offset explicitly
   (`sgWeekStart`, `sgMonthStart`). It never reads the host's `TZ`.
3. **The handshake with the Mini App.** A challenge's `publishAt` is stored as
   the UTC instant of Monday 05:00 SGT. The broadcast and `GET /api/home` both
   use "latest challenge with `publishAt <= now`", so the moment the push goes
   out, the app shows the same challenge.
4. **Proof.** The whole test suite runs with `TZ=America/New_York`. The cron
   tests check the server's real task matches `2026-10-18T21:00Z` (Mon 05:00 SGT)
   and not Monday 05:00 UTC or New York, and that its next 10 runs are all
   Sunday 21:00 UTC, exactly 7 days apart.

### Broadcast flow (`services/broadcast.ts`)

1. Find **this SGT week's** challenge (`SCHEDULED`/`PUBLISHED`, `publishAt`
   passed within the last 24 h). Last week's is never re-sent.
2. **Claim it atomically**: `UPDATE … SET broadcastStartedAt = now WHERE broadcastStartedAt IS NULL`.
   Only one caller wins, so the Monday job, the 15-minute catch-up sweep, a
   restart or a second instance can't send twice.
3. Load this month's `MonthlyGoal` and build one HTML message (verse,
   initiatives, goal; admin text escaped and clipped under 4096 characters)
   with the app button.
4. Page through users who are not `botBlocked` and have `notificationsEnabled`,
   200 at a time. Each `sendMessage` has its own `try/catch`. On 403 (blocked)
   or "chat not found", the user is logged by internal ID and flagged
   `botBlocked`. Other errors are logged. Either way the loop continues.
   Sending is throttled to 25 msgs/s, and 429s are retried honouring `retry_after`.
5. Record `broadcastCompletedAt` and the sent/failed counts on the challenge.

**Catch-up sweep** (`*/15 * * * *`, also at startup): if the server was down
at 05:00, or an admin publishes this week's challenge late, the broadcast still
goes out within 15 minutes, as long as it's within 24 h of `publishAt`.

**Limitation:** if the process dies mid-broadcast, the challenge stays claimed
and the remaining users are not retried automatically, so nobody gets a duplicate.
The counts on the challenge show it.

## Local development

```bash
docker compose up -d db              # or any Postgres 16
cp server/.env.example server/.env
npm install
npm run db:migrate                   # applies prisma/migrations
npm run db:seed                      # Cell Groups AP1–AP4
npm run dev                          # API on :3000
npm test                             # needs Postgres; uses ap_building_fund_test

# Call the API outside Telegram with a correctly signed header:
curl -H "Authorization: $(npm run -s sign-init-data -w server -- 123456789 Grace)" \
     localhost:3000/api/me
```
