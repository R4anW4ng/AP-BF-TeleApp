import { z } from "zod";
import type { User } from "../generated/prisma/client.js";
import type { Viewer } from "./privacy.js";

/** The author columns `feedAuthor` needs. Never select more than this for other people. */
export const authorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  cellGroupId: true,
  stayAnonymous: true,
  showOnBoards: true,
} as const;

export const cellGroupSelect = { id: true, code: true, name: true } as const;

export function viewerOf(user: User): Viewer {
  return { id: user.id, cellGroupId: user.cellGroupId };
}

/** `?cursor=<id>&limit=<n>` — newest first, stable across inserts. */
export const PageQuerySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Prisma args for a (createdAt desc, id desc) page; fetches one extra row to detect a next page. */
export function pageArgs({ cursor, limit }: z.infer<typeof PageQuerySchema>) {
  return {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

export function toPage<T extends { id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/** Trimmed, non-empty user text. */
export const text = (max: number) => z.string().trim().min(1, "Can't be empty").max(max);
