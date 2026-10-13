# API reference (Phase 2)

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

## Health (no auth)

`GET /health` → `{ ok: true }` · `GET /health/ready` → also checks the database.
