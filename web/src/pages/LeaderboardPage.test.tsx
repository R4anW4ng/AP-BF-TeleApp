import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { IndividualBoard } from "../api/types";
import { IndividualList, MyRank } from "./LeaderboardPage";

const board: IndividualBoard = {
  participants: 3,
  me: { rank: 2, points: 50, hidden: false },
  entries: [
    { rank: 1, name: "Grace Tan", isMe: false, cellGroup: "AP1", points: 100 },
    { rank: 2, name: "Ben Lim", isMe: true, cellGroup: "AP1", points: 50 },
    { rank: 2, name: "Anonymous", isMe: false, cellGroup: null, points: 50 },
  ],
};

describe("leaderboard views", () => {
  it("shows medals, 'You', and no CG badge for Anonymous entries", () => {
    render(<IndividualList board={board} />);
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual(["🥇Grace TanAP1100", "🥈YouAP150", "🥈Anonymous50"]);
  });

  it("explains why a Stay Anonymous member isn't listed", () => {
    render(<MyRank me={{ rank: null, points: 120, hidden: true }} />);
    expect(screen.getByText(/hidden from this board/).textContent).toContain("120 points still count");
  });

  it("shows the viewer's rank", () => {
    render(<MyRank me={board.me} />);
    expect(screen.getByText(/You're/).textContent).toBe("You're #2 with 50 points.");
  });
});
