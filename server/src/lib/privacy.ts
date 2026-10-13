/**
 * The one place that decides whose real name a viewer may see.
 * The API applies these before responding, so a hidden name never reaches the client.
 */

export const ANONYMOUS = "Anonymous";
export const FORMER_MEMBER = "Former Member";

export interface Person {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  cellGroupId: string | null;
  stayAnonymous: boolean;
  showOnBoards: boolean;
}

export interface Viewer {
  id: string;
  cellGroupId: string | null;
}

export function realName(p: Pick<Person, "firstName" | "lastName" | "displayName">): string {
  return p.displayName?.trim() || [p.firstName, p.lastName].filter(Boolean).join(" ");
}

function sameCellGroup(a: Pick<Person, "cellGroupId">, b: Viewer): boolean {
  return a.cellGroupId !== null && a.cellGroupId === b.cellGroupId;
}

/**
 * Individual leaderboard. Returns null when the member must not be listed.
 *
 * | Stay Anonymous | Show me on boards | Listed? | Name shown                                  |
 * |----------------|-------------------|---------|---------------------------------------------|
 * | ON             | (any)             | No      | — (points still count toward the CG total)  |
 * | OFF            | ON                | Yes     | real name to CG peers, "Anonymous" to others |
 * | OFF            | OFF               | Yes     | real name to everyone                       |
 */
export function leaderboardName(member: Person, viewer: Viewer): string | null {
  if (member.stayAnonymous) return null;
  if (member.id === viewer.id) return realName(member);
  if (member.showOnBoards) return sameCellGroup(member, viewer) ? realName(member) : ANONYMOUS;
  return realName(member);
}

export interface FeedAuthor {
  name: string;
  /** True when the viewer is the author (UI can show "You"). */
  isMe: boolean;
  /** True when others see this post as Anonymous. */
  isAnonymous: boolean;
}

/**
 * Prayer Wall, Living it Out and comments.
 * "Stay Anonymous" hides the name on feeds; so does the per-post anonymous flag.
 * The author always sees their own name. A deleted author is "Former Member".
 */
export function feedAuthor(author: Person | null, postIsAnonymous: boolean, viewer: Viewer): FeedAuthor {
  if (!author) return { name: FORMER_MEMBER, isMe: false, isAnonymous: false };
  const hidden = postIsAnonymous || author.stayAnonymous;
  if (author.id === viewer.id) return { name: realName(author), isMe: true, isAnonymous: hidden };
  return { name: hidden ? ANONYMOUS : realName(author), isMe: false, isAnonymous: hidden };
}
