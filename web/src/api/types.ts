/** Response shapes of the server API (see docs/API.md). Dates arrive as ISO strings. */

export type Role = "USER" | "ADMIN";
export type ReactionType = "HEART" | "AMEN" | "PRAYING" | "HUG";

export interface CellGroup {
  id: string;
  code: string;
  name: string;
}

export interface Usage {
  used: number;
  cap: number;
  points: number;
}

export interface Me {
  id: string;
  name: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  displayName: string | null;
  photoUrl: string | null;
  role: Role;
  isAdmin: boolean;
  zone: string;
  cellGroup: CellGroup | null;
  privacy: { stayAnonymous: boolean; showOnBoards: boolean };
  notificationsEnabled: boolean;
  pinEnabled: boolean;
  points: { total: number; currentStreak: number; longestStreak: number };
  usage: { TITHE: Usage; MEAL_LOG: Usage; LIVING_POST: Usage };
}

export interface CampaignInfo {
  start: string;
  end: string;
  hasStarted: boolean;
  hasEnded: boolean;
  weekNumber: number | null;
  totalWeeks: number;
  daysRemaining: number;
  weeksRemaining: number;
}

export interface Home {
  zone: string;
  campaign: CampaignInfo;
  challenge: {
    id: string;
    weekNumber: number;
    title: string;
    financialInitiatives: string[];
    description: string | null;
    memoryVerseText: string;
    memoryVerseRef: string;
    weekStart: string;
    publishAt: string;
  } | null;
  monthlyGoal: { id: string; month: string; title: string; description: string | null } | null;
}

export type AwardResult =
  | { awarded: true; points: number; used: number; cap: number; totalPoints: number; currentStreak: number }
  | { awarded: false; reason: "CAP_REACHED"; used: number; cap: number };

export interface FeedAuthor {
  name: string;
  isMe: boolean;
  isAnonymous: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ReactionSummary {
  counts: Record<ReactionType, number>;
  mine: ReactionType[];
}

export interface PrayerComment {
  id: string;
  content: string;
  createdAt: string;
  author: FeedAuthor;
}

export interface Prayer {
  id: string;
  content: string;
  isAnswered: boolean;
  createdAt: string;
  author: FeedAuthor;
  cellGroup: CellGroup | null;
  reactions: ReactionSummary;
  commentCount: number;
  comments: PrayerComment[];
}

export interface LivingPost {
  id: string;
  content: string;
  weekNumber: number;
  createdAt: string;
  author: FeedAuthor;
  cellGroup: CellGroup | null;
  images: { id: string; url: string | null; width: number | null; height: number | null }[];
}

export type TestimonyBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; cite: string | null }
  | { type: "image"; mediaId: string; caption: string | null; url?: string | null; width?: number | null; height?: number | null };

export interface TestimonySummary {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  byline: string | null;
  status: "DRAFT" | "PUBLISHED" | "SCHEDULED" | "ARCHIVED";
  publishedAt: string | null;
  coverUrl: string | null;
  excerpt: string | null;
}

export interface Testimony extends TestimonySummary {
  updatedAt: string;
  blocks: TestimonyBlock[];
}

export interface UploadedImage {
  id: string;
  url: string;
  width: number;
  height: number;
}
