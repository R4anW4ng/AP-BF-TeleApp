import { describe, expect, it } from "vitest";
import { feedAuthor, leaderboardName, type Person } from "../src/lib/privacy.js";

const person = (overrides: Partial<Person> = {}): Person => ({
  id: "member",
  firstName: "Grace",
  lastName: "Tan",
  displayName: null,
  cellGroupId: "AP1",
  stayAnonymous: false,
  showOnBoards: false,
  ...overrides,
});
const peer = { id: "peer", cellGroupId: "AP1" };
const outsider = { id: "outsider", cellGroupId: "AP2" };
const noGroup = { id: "new", cellGroupId: null };

describe("leaderboardName", () => {
  it("Stay Anonymous ON: not listed at all, for anyone", () => {
    const m = person({ stayAnonymous: true, showOnBoards: true });
    expect(leaderboardName(m, peer)).toBeNull();
    expect(leaderboardName(m, outsider)).toBeNull();
    expect(leaderboardName(m, { id: "member", cellGroupId: "AP1" })).toBeNull();
  });

  it("Show me on boards ON: real name to CG peers, Anonymous to outsiders", () => {
    const m = person({ showOnBoards: true });
    expect(leaderboardName(m, peer)).toBe("Grace Tan");
    expect(leaderboardName(m, outsider)).toBe("Anonymous");
    expect(leaderboardName(m, noGroup)).toBe("Anonymous");
    expect(leaderboardName(m, { id: "member", cellGroupId: "AP1" })).toBe("Grace Tan");
  });

  it("a member without a CG is Anonymous to everyone else when Show me on boards is ON", () => {
    expect(leaderboardName(person({ showOnBoards: true, cellGroupId: null }), noGroup)).toBe("Anonymous");
  });

  it("both OFF: real name to everyone", () => {
    expect(leaderboardName(person(), outsider)).toBe("Grace Tan");
    expect(leaderboardName(person({ displayName: "Gracie" }), outsider)).toBe("Gracie");
  });
});

describe("feedAuthor", () => {
  it("shows Former Member for deleted authors", () => {
    expect(feedAuthor(null, false, peer).name).toBe("Former Member");
  });

  it("hides the name when Stay Anonymous is ON or the post is anonymous", () => {
    expect(feedAuthor(person({ stayAnonymous: true }), false, peer).name).toBe("Anonymous");
    expect(feedAuthor(person(), true, peer).name).toBe("Anonymous");
    expect(feedAuthor(person(), false, outsider).name).toBe("Grace Tan");
  });

  it("always shows authors their own name", () => {
    expect(feedAuthor(person({ stayAnonymous: true }), true, { id: "member", cellGroupId: "AP1" })).toEqual({
      name: "Grace Tan",
      isMe: true,
      isAnonymous: true,
    });
  });
});
