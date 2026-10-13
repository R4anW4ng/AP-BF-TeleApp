# API reference

Base path `/api`. Every request needs:

```
Authorization: tma <Telegram.WebApp.initData>
```

Errors always look like `{ "error": { "code": "…", "message": "…", …details } }`.

| Status | `code`                          | Meaning for the client                            |
|--------|---------------------------------|---------------------------------------------------|
| 401    | `UNAUTHENTICATED`               | No header sent                                     |
| 401    | `INVALID_INIT_DATA`             | Signature check failed                             |
| 401    | `INIT_DATA_EXPIRED`             | Ask the user to close and reopen the Mini App      |
| 400    | `VALIDATION_ERROR`              | `issues: [{ path, message }]`                      |
| 403    | `FORBIDDEN`                     | Admin-only action                                  |
| 429    | `RATE_LIMITED`                  | Slow down                                          |
| 503    | `STORAGE_UNAVAILABLE`           | R2 not configured                                  |

## Profile — `/api/me`

| Method & path           | Body                                   | Returns |
|-------------------------|----------------------------------------|---------|
| `GET /me`               | —                                      | Profile (below). Creates the user on first call. |
| `PATCH /me`             | any of `displayName` (≤40, or null), `cellGroupId`, `stayAnonymous`, `showOnBoards`, `notificationsEnabled` | Profile. `409 CELL_GROUP_LOCKED` if a CG is already set (admins excepted). |
| `PUT /me/pin`           | `{ pin, currentPin? }` (4–6 digits)    | `{ pinEnabled: true }`. Changing a PIN needs `currentPin`. |
| `POST /me/pin/verify`   | `{ pin }`                              | `{ ok: true }` · `403 PIN_INCORRECT { attemptsRemaining }` · `423 PIN_LOCKED { lockedUntil }` |
| `DELETE /me/pin`        | `{ pin }`                              | `{ pinEnabled: false }` |
| `DELETE /me`            | `{ confirm: "DELETE" }`                | `204`. Hard-deletes personal data (see ARCHITECTURE.md). |

Profile:

```json
{
  "id": "cmv…", "name": "Grace Tan", "firstName": "Grace", "lastName": "Tan",
  "username": "gracet", "displayName": null, "photoUrl": null,
  "role": "USER", "isAdmin": false, "zone": "AP",
  "cellGroup": { "id": "cmv…", "code": "AP1", "name": "Cell Group AP1" },
  "privacy": { "stayAnonymous": false, "showOnBoards": true },
  "notificationsEnabled": true, "pinEnabled": false,
  "points": { "total": 120, "currentStreak": 4, "longestStreak": 9 },
  "usage": {
    "TITHE":       { "used": 1, "cap": 1, "points": 100 },
    "MEAL_LOG":    { "used": 2, "cap": 3, "points": 5 },
    "LIVING_POST": { "used": 0, "cap": 2, "points": 10 }
  }
}
```

## Home — `GET /api/home`

```json
{
  "zone": "AP",
  "campaign": { "start": "2026-10-19", "end": "2027-02-28", "hasStarted": true, "hasEnded": false,
                "weekNumber": 3, "totalWeeks": 19, "daysRemaining": 112, "weeksRemaining": 16 },
  "challenge": { "id": "…", "weekNumber": 3, "title": "…", "financialInitiatives": ["No Grab", "Water Only"],
                 "description": null, "memoryVerseText": "…", "memoryVerseRef": "Malachi 3:10",
                 "weekStart": "2026-11-02T00:00:00.000Z", "publishAt": "2026-11-01T21:00:00.000Z" },
  "monthlyGoal": { "id": "…", "month": "2026-11-01T00:00:00.000Z", "title": "Sacrifice ME time", "description": "…" }
}
```

`challenge` and `monthlyGoal` are `null` when none is published yet.

## Points — `/api/points`

| Method & path            | Returns |
|--------------------------|---------|
| `POST /points/meal-log`  | `{ awarded: true, points: 5, used, cap: 3, totalPoints, currentStreak }` or `{ awarded: false, reason: "CAP_REACHED", used: 3, cap: 3 }` |
| `POST /points/tithe`     | Same shape; 100 points, once per SGT month. No amount is sent or stored. |

Living it Out points (10, max 2 per day) are awarded automatically when a post is created.

## Cell Groups — `GET /api/cell-groups`

`{ "cellGroups": [{ "id", "code": "AP1", "name": "Cell Group AP1" }, …] }`

## Uploads — `POST /api/uploads?kind=LIVING_POST|TESTIMONY`

`multipart/form-data` with one file in the field `image` (JPEG/PNG/WebP/HEIC/AVIF/GIF, ≤10 MB).
`TESTIMONY` is admin-only. Returns `201 { id, url, width, height }`. Send `id`
with the post that uses the photo. Images are re-encoded to WebP (max 1600 px)
and all metadata, including GPS location, is removed.

## Feeds

Lists are newest first and paginated with `?cursor=<nextCursor>&limit=<1–50, default 20>`.
They return `{ items, nextCursor }`, where `nextCursor` is `null` on the last page.
Authors are resolved server-side by the privacy rules into
`{ name, isMe, isAnonymous }`. No other user's id, Telegram ID or raw name is
ever returned. A deleted author is `"Former Member"`.

### Prayer Wall: `/api/prayers`

| Method & path                     | Body                                   | Returns |
|-----------------------------------|----------------------------------------|---------|
| `GET /prayers`                    | —                                      | Page of prayers: `{ id, content, isAnswered, createdAt, author, cellGroup, reactions: { counts: {HEART, AMEN, PRAYING, HUG}, mine: [...] }, commentCount, comments: [{ id, content, createdAt, author }] }` (up to 50 comments each, oldest first) |
| `POST /prayers`                   | `{ content (≤2000), isAnonymous? }`    | `201` prayer |
| `POST /prayers/:id/comments`      | `{ content (≤1000), isAnonymous? }`    | `201` the updated prayer |
| `POST /prayers/:id/reactions`     | `{ type: "HEART"\|"AMEN"\|"PRAYING"\|"HUG" }` | `{ id, reactions }`. Toggles: a second tap removes it. |

### Living it Out: `/api/living`

| Method & path      | Body | Returns |
|--------------------|------|---------|
| `GET /living?zone=AP1` | — | Page of `{ id, content, weekNumber (0 = before launch), createdAt, author, cellGroup, images: [{ id, url, width, height }] }`. Omit `zone` or pass `ALL` for every Cell Group. |
| `POST /living`     | `multipart/form-data`: `content` (≤2000), `isAnonymous` (`"true"`/`"false"`), 0–4 files in `images` (≤10 MB each) | `201 { post, points }`. `points` is an award result: 10 points, max 2 per SGT day. Past the cap the post is still published with `points.awarded: false`. Photos are re-encoded to WebP and stripped of GPS location before going to R2. If anything fails, nothing is kept. |

### Testimonies: `/api/testimonies`

| Method & path              | Who    | Returns |
|----------------------------|--------|---------|
| `GET /testimonies`         | all    | `{ items: [{ id, slug, title, subtitle, byline, status, publishedAt, coverUrl, excerpt }] }`, published only. Admins can add `?status=all` to include drafts. |
| `GET /testimonies/:idOrSlug` | all  | Summary fields plus `updatedAt` and `blocks`. Image blocks include `url`, `width` and `height`. Drafts return 404 to non-admins. |
| `POST /testimonies`        | admin  | Body below. `201` full testimony. |
| `PUT /testimonies/:id`     | admin  | Full replace with the same body. Images no longer referenced are deleted. |
| `DELETE /testimonies/:id`  | admin  | `204`. Its images are deleted from the database and R2. |

```json
{
  "title": "How God provided our rent",
  "subtitle": "optional", "byline": "A family in AP2", "coverMediaId": "optional upload id",
  "status": "DRAFT | PUBLISHED",
  "blocks": [
    { "type": "heading", "text": "…" },
    { "type": "paragraph", "text": "…" },
    { "type": "quote", "text": "…", "cite": "Philippians 4:19" },
    { "type": "image", "mediaId": "<id from POST /api/uploads?kind=TESTIMONY>", "caption": "…" }
  ]
}
```

Testimonies have no comments or reactions. Every create, update and delete is written to the audit log.

## Health (no auth)

`GET /health` → `{ ok: true }` · `GET /health/ready` → also checks the database.
