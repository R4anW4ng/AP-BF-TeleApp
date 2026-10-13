import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useCellGroupBoard, useIndividualBoard } from "../api/admin";
import type { CellGroupBoard, IndividualBoard } from "../api/types";
import { ErrorView, Loading, PageHeader } from "../components/ui";
import { useBackButton } from "../telegram";

const MEDALS = ["🥇", "🥈", "🥉"];
const rankLabel = (rank: number) => MEDALS[rank - 1] ?? `#${rank}`;

export function MyRank({ me }: { me: IndividualBoard["me"] }) {
  if (me.hidden) {
    return <p className="hint">You're hidden from this board (Stay Anonymous). Your {me.points} points still count for your Cell Group.</p>;
  }
  if (me.rank === null) return <p className="hint">Log a meal or share a post to get on the board.</p>;
  return (
    <p className="hint">
      You're <strong>#{me.rank}</strong> with {me.points} points.
    </p>
  );
}

export function IndividualList({ board }: { board: IndividualBoard }) {
  if (board.entries.length === 0) return <p className="hint">No one has points yet.</p>;
  return (
    <ol className="board">
      {board.entries.map((e, i) => (
        <li key={i} className={`board-row${e.isMe ? " me" : ""}`}>
          <span className="rank">{rankLabel(e.rank)}</span>
          <span className="who">
            {e.isMe ? "You" : e.name}
            {e.cellGroup && <span className="badge">{e.cellGroup}</span>}
          </span>
          <span className="pts">{e.points}</span>
        </li>
      ))}
    </ol>
  );
}

function CellGroupList({ board }: { board: CellGroupBoard }) {
  const top = Math.max(1, ...board.entries.map((e) => e.points));
  return (
    <ol className="board">
      {board.entries.map((e) => (
        <li key={e.id} className={`board-row cg${e.isMine ? " me" : ""}`}>
          <span className="rank">{rankLabel(e.rank)}</span>
          <span className="who">
            <strong>{e.code}</strong> <span className="hint">{e.members} member{e.members === 1 ? "" : "s"}{e.isMine ? " · yours" : ""}</span>
            <span className="bar" aria-hidden="true">
              <span style={{ width: `${(e.points / top) * 100}%` }} />
            </span>
          </span>
          <span className="pts">{e.points}</span>
        </li>
      ))}
    </ol>
  );
}

function Individuals() {
  const board = useIndividualBoard();
  if (board.isPending) return <Loading />;
  if (board.isError) return <ErrorView error={board.error} onRetry={() => void board.refetch()} />;
  return (
    <>
      <div className="card">
        <MyRank me={board.data.me} />
      </div>
      <IndividualList board={board.data} />
      <p className="hint">Names follow each member's privacy settings. Members on Stay Anonymous aren't listed.</p>
    </>
  );
}

function CellGroups() {
  const board = useCellGroupBoard();
  if (board.isPending) return <Loading />;
  if (board.isError) return <ErrorView error={board.error} onRetry={() => void board.refetch()} />;
  return (
    <>
      <CellGroupList board={board.data} />
      <p className="hint">Total points of every member in each Cell Group, including anonymous members.</p>
    </>
  );
}

export function LeaderboardPage() {
  const navigate = useNavigate();
  useBackButton(useCallback(() => void navigate("/"), [navigate]));
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "cg" ? "cg" : "individuals";

  return (
    <>
      <PageHeader title="🏆 Leaderboard" subtitle="Building Fund campaign" />
      <div className="segmented" role="tablist" aria-label="Leaderboard view">
        <button role="tab" aria-selected={view === "individuals"} onClick={() => setParams({}, { replace: true })}>
          Individuals
        </button>
        <button role="tab" aria-selected={view === "cg"} onClick={() => setParams({ view: "cg" }, { replace: true })}>
          Cell Groups
        </button>
      </div>
      {view === "cg" ? <CellGroups /> : <Individuals />}
    </>
  );
}
