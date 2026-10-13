import { type FormEvent, useState } from "react";
import { useAdminGoals, useDeleteGoal, useSaveGoal } from "../../api/admin";
import type { AdminGoal } from "../../api/types";
import { ErrorView, Loading, Section } from "../../components/ui";
import { formatMonthKey } from "../../lib/format";
import { confirmDialog, haptic } from "../../telegram";

function GoalCard({ month, goal }: { month: string; goal?: AdminGoal }) {
  const save = useSaveGoal();
  const remove = useDeleteGoal();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const dirty = title !== (goal?.title ?? "") || description !== (goal?.description ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ month, title, description: description.trim() || null }, { onSuccess: () => haptic("success") });
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row">
        <h3>{formatMonthKey(month)}</h3>
        <span className={`badge${goal ? "" : " muted"}`}>{goal ? "Set" : "Not set"}</span>
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Spiritual goal, e.g. Sacrifice ME time" aria-label={`${month} goal`} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} placeholder="A sentence of encouragement (optional)" aria-label={`${month} description`} />
      <div className="row">
        {goal ? (
          <button
            type="button"
            className="btn small danger"
            disabled={remove.isPending}
            onClick={async () => {
              if (await confirmDialog(`Remove the ${formatMonthKey(month)} goal?`)) remove.mutate(month);
            }}
          >
            Remove
          </button>
        ) : (
          <span />
        )}
        <button className="btn small" disabled={!title.trim() || !dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {(save.isError || remove.isError) && <p className="error-text">{(save.error ?? remove.error)?.message}</p>}
    </form>
  );
}

export function GoalsAdmin() {
  const goals = useAdminGoals();
  if (goals.isPending) return <Loading />;
  if (goals.isError) return <ErrorView error={goals.error} onRetry={() => void goals.refetch()} />;
  const byMonth = new Map(goals.data.items.map((g) => [g.month, g]));
  return (
    <Section title="Monthly spiritual goals">
      <p className="hint">Shown on Home for the whole month and included in each Monday message.</p>
      <div className="feed">
        {goals.data.months.map((m) => (
          <GoalCard key={`${m}:${byMonth.get(m)?.updatedAt ?? "new"}`} month={m} goal={byMonth.get(m)} />
        ))}
      </div>
    </Section>
  );
}
