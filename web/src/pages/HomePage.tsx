import { Link } from "react-router";
import { useHome, useLogPoints, useMe } from "../api";
import { useIndividualBoard } from "../api/admin";
import type { AwardResult, Usage } from "../api/types";
import { ErrorView, Loading, PageHeader, Section } from "../components/ui";
import { formatDate, formatMonth } from "../lib/format";
import { haptic } from "../telegram";
import { IndividualList, MyRank } from "./LeaderboardPage";

function awardMessage(result: AwardResult | undefined, capped: string): string | null {
  if (!result) return null;
  return result.awarded ? `+${result.points} points!` : capped;
}

function LogButton({ kind, usage, label, capped }: { kind: "meal-log" | "tithe"; usage: Usage; label: string; capped: string }) {
  const log = useLogPoints(kind);
  const done = usage.used >= usage.cap;
  return (
    <div className="log-action">
      <button
        className="btn block"
        disabled={done || log.isPending}
        onClick={() => log.mutate(undefined, { onSuccess: (r) => haptic(r.awarded ? "success" : "warning") })}
      >
        {label} <span className="btn-meta">{usage.used}/{usage.cap}</span>
      </button>
      <p className="hint">
        {log.isError ? log.error.message : awardMessage(log.data, capped) ?? (done ? capped : `+${usage.points} points`)}
      </p>
    </div>
  );
}

function LeaderboardPreview() {
  const board = useIndividualBoard(3);
  return (
    <Section title="🏆 Leaderboard" aside={<Link to="/leaderboard">See all</Link>}>
      <Link to="/leaderboard" className="card board-preview">
        {board.data ? (
          <>
            <IndividualList board={board.data} />
            <MyRank me={board.data.me} />
          </>
        ) : (
          <p className="hint">{board.isError ? board.error.message : "Loading…"}</p>
        )}
      </Link>
    </Section>
  );
}

export function HomePage() {
  const home = useHome();
  const me = useMe();

  if (home.isPending) return <Loading />;
  if (home.isError) return <ErrorView error={home.error} onRetry={() => void home.refetch()} />;
  const { campaign, challenge, monthlyGoal, zone } = home.data;

  return (
    <>
      <PageHeader title={`${zone} Building Fund`} subtitle={`Until ${formatDate(campaign.end)}`} />

      <Section>
        <div className="countdown">
          {campaign.hasEnded ? (
            <p className="big">The campaign has ended 🎉</p>
          ) : campaign.hasStarted ? (
            <>
              <p className="big">{campaign.weeksRemaining}</p>
              <p className="hint">
                weeks to go · Week {campaign.weekNumber} of {campaign.totalWeeks}
              </p>
            </>
          ) : (
            <>
              <p className="big">{campaign.daysRemaining}</p>
              <p className="hint">days of campaign · starts {formatDate(campaign.start)}</p>
            </>
          )}
        </div>
      </Section>

      <Section title={challenge ? `This week · Week ${challenge.weekNumber}` : "This week"}>
        {challenge ? (
          <div className="card">
            <h3>{challenge.title}</h3>
            <ul className="initiatives">
              {challenge.financialInitiatives.map((item) => (
                <li key={item}>💰 {item}</li>
              ))}
            </ul>
            {challenge.description && <p>{challenge.description}</p>}
            <blockquote className="verse">
              “{challenge.memoryVerseText}”<cite>{challenge.memoryVerseRef}</cite>
            </blockquote>
          </div>
        ) : (
          <p className="hint">This week's challenge will appear here on Monday at 5:00 AM.</p>
        )}
      </Section>

      {monthlyGoal && (
        <Section title={`${formatMonth(monthlyGoal.month)} spiritual goal`}>
          <div className="card">
            <h3>🙏 {monthlyGoal.title}</h3>
            {monthlyGoal.description && <p>{monthlyGoal.description}</p>}
          </div>
        </Section>
      )}

      {me.data && (
        <Section title="Log today" aside={<span className="badge">{me.data.points.total} pts</span>}>
          <LogButton kind="meal-log" usage={me.data.usage.MEAL_LOG} label="🍱 Daily Meal Log" capped="Done for today: see you tomorrow!" />
          <LogButton kind="tithe" usage={me.data.usage.TITHE} label="🙌 I've tithed this month" capped="Logged for this month. Thank you!" />
        </Section>
      )}

      <LeaderboardPreview />
    </>
  );
}
