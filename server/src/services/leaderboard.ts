import { prisma } from "../db.js";
import type { User } from "../generated/prisma/client.js";
import { authorSelect } from "../lib/feed.js";
import { ANONYMOUS, leaderboardName, type Viewer } from "../lib/privacy.js";

/** Standard competition ranking ("1, 2, 2, 4") over rows already sorted by points desc. */
function rank<T extends { points: number }>(rows: T[]): (T & { rank: number })[] {
  let previous: { points: number; rank: number } | undefined;
  return rows.map((row, i) => {
    const r = previous && previous.points === row.points ? previous.rank : i + 1;
    previous = { points: row.points, rank: r };
    return { ...row, rank: r };
  });
}

/** Members who may appear on the individual board: not Stay Anonymous, with points. */
const listed = { stayAnonymous: false, totalPoints: { gt: 0 } };

/**
 * Individual ranking. Who appears and under what name follows `leaderboardName`:
 * Stay Anonymous members are left out entirely (their points still count for
 * their CG); "Show me on boards" members are "Anonymous" to people outside their
 * CG. A name shown as Anonymous also hides the CG badge.
 */
export async function individualLeaderboard(viewer: User, limit: number) {
  const v: Viewer = { id: viewer.id, cellGroupId: viewer.cellGroupId };
  const [rows, participants] = await Promise.all([
    prisma.user.findMany({
      where: listed,
      orderBy: [{ totalPoints: "desc" }, { id: "asc" }],
      take: limit,
      select: { ...authorSelect, totalPoints: true, cellGroup: { select: { code: true } } },
    }),
    prisma.user.count({ where: listed }),
  ]);

  const entries = rank(rows.map((r) => ({ ...r, points: r.totalPoints }))).map((r) => {
    const name = leaderboardName(r, v)!; // `listed` already excludes the null case
    return {
      rank: r.rank,
      name,
      isMe: r.id === viewer.id,
      cellGroup: name === ANONYMOUS ? null : (r.cellGroup?.code ?? null),
      points: r.points,
    };
  });

  let me: { rank: number | null; points: number; hidden: boolean };
  if (viewer.stayAnonymous) {
    me = { rank: null, points: viewer.totalPoints, hidden: true };
  } else if (viewer.totalPoints <= 0) {
    me = { rank: null, points: 0, hidden: false };
  } else {
    const ahead = await prisma.user.count({ where: { ...listed, totalPoints: { gt: viewer.totalPoints } } });
    me = { rank: ahead + 1, points: viewer.totalPoints, hidden: false };
  }

  return { entries, participants, me };
}

/** CG vs CG: every active Cell Group with the summed points of all its members (anonymous ones included). */
export async function cellGroupLeaderboard(viewer: User) {
  const [groups, sums] = await Promise.all([
    prisma.cellGroup.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, sortOrder: true } }),
    prisma.user.groupBy({
      by: ["cellGroupId"],
      where: { cellGroupId: { not: null } },
      _sum: { totalPoints: true },
      _count: { _all: true },
    }),
  ]);
  const byId = new Map(sums.map((s) => [s.cellGroupId, s]));
  const rows = groups
    .map((g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      sortOrder: g.sortOrder,
      points: byId.get(g.id)?._sum.totalPoints ?? 0,
      members: byId.get(g.id)?._count._all ?? 0,
    }))
    .sort((a, b) => b.points - a.points || a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  return {
    entries: rank(rows).map(({ sortOrder: _s, ...r }) => ({ ...r, isMine: r.id === viewer.cellGroupId })),
  };
}
