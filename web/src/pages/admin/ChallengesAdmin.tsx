import { type FormEvent, useState } from "react";
import { useAdminChallenges, useDeleteChallenge, useSaveChallenge } from "../../api/admin";
import type { AdminChallenge, ChallengeInput } from "../../api/types";
import { ErrorView, Loading, Section } from "../../components/ui";
import { formatDateTime, formatDay } from "../../lib/format";
import { confirmDialog, haptic } from "../../telegram";

const MAX_INITIATIVES = 8;

/** What members experience right now for this challenge. */
export function challengeState(c: AdminChallenge, now: Date = new Date()): { label: string; tone: "muted" | "pending" | "live" | "done" } {
  if (c.status === "DRAFT") return { label: "Draft: hidden, won't be sent", tone: "muted" };
  if (c.broadcast.completedAt) {
    return { label: `Sent to ${c.broadcast.sent}${c.broadcast.failed ? ` (${c.broadcast.failed} failed)` : ""}`, tone: "done" };
  }
  if (c.broadcast.startedAt) return { label: "Sending…", tone: "live" };
  if (new Date(c.publishAt) > now) return { label: `Scheduled · ${formatDateTime(c.publishAt)}`, tone: "pending" };
  return { label: "Live on Home", tone: "live" };
}

const blank = (weekStart: string): ChallengeInput => ({
  weekStart,
  title: "",
  financialInitiatives: [""],
  description: null,
  memoryVerseText: "",
  memoryVerseRef: "",
  status: "SCHEDULED",
});

const toInput = (c: AdminChallenge): ChallengeInput => ({
  weekStart: c.weekStart,
  title: c.title,
  financialInitiatives: c.financialInitiatives,
  description: c.description,
  memoryVerseText: c.memoryVerseText,
  memoryVerseRef: c.memoryVerseRef,
  status: c.status === "DRAFT" ? "DRAFT" : "SCHEDULED",
});

function ChallengeForm({
  initial,
  editing,
  weeks,
  takenWeeks,
  onDone,
}: {
  initial: ChallengeInput;
  editing?: AdminChallenge;
  weeks: { weekStart: string; weekNumber: number }[];
  takenWeeks: Set<string>;
  onDone: () => void;
}) {
  const save = useSaveChallenge();
  const [form, setForm] = useState<ChallengeInput>(initial);
  const set = <K extends keyof ChallengeInput>(key: K, value: ChallengeInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const sent = Boolean(editing?.broadcast.startedAt);

  function setInitiative(i: number, value: string) {
    set("financialInitiatives", form.financialInitiatives.map((v, j) => (j === i ? value : v)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const input = { ...form, financialInitiatives: form.financialInitiatives.map((s) => s.trim()).filter(Boolean), description: form.description?.trim() || null };
    save.mutate(
      { id: editing?.id, input },
      {
        onSuccess: () => {
          haptic("success");
          onDone();
        },
      },
    );
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>{editing ? `Edit week ${editing.weekNumber}` : "New weekly challenge"}</h3>
      <label className="field">
        <span>Week</span>
        <select value={form.weekStart} onChange={(e) => set("weekStart", e.target.value)} disabled={sent} aria-label="Week">
          {weeks.map((w) => (
            <option key={w.weekStart} value={w.weekStart} disabled={takenWeeks.has(w.weekStart) && w.weekStart !== editing?.weekStart}>
              Week {w.weekNumber} · Mon {formatDay(w.weekStart)}
              {takenWeeks.has(w.weekStart) && w.weekStart !== editing?.weekStart ? " (has a challenge)" : ""}
            </option>
          ))}
        </select>
      </label>
      {sent && <p className="hint">Already broadcast: you can fix the text (Home updates), but it won't be sent again.</p>}
      <label className="field">
        <span>Title</span>
        <input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required placeholder="e.g. Kick-off week" />
      </label>

      <fieldset className="field">
        <legend>Financial initiatives</legend>
        {form.financialInitiatives.map((item, i) => (
          <div key={i} className="row">
            <input value={item} onChange={(e) => setInitiative(i, e.target.value)} maxLength={80} placeholder="e.g. No Grab" aria-label={`Initiative ${i + 1}`} />
            {form.financialInitiatives.length > 1 && (
              <button type="button" className="btn small secondary" aria-label={`Remove initiative ${i + 1}`} onClick={() => set("financialInitiatives", form.financialInitiatives.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </div>
        ))}
        {form.financialInitiatives.length < MAX_INITIATIVES && (
          <button type="button" className="btn small secondary" onClick={() => set("financialInitiatives", [...form.financialInitiatives, ""])}>
            + Add initiative
          </button>
        )}
      </fieldset>

      <label className="field">
        <span>Notes (optional)</span>
        <textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={600} rows={2} />
      </label>
      <label className="field">
        <span>Memory verse</span>
        <textarea value={form.memoryVerseText} onChange={(e) => set("memoryVerseText", e.target.value)} maxLength={900} rows={3} required />
      </label>
      <label className="field">
        <span>Reference</span>
        <input value={form.memoryVerseRef} onChange={(e) => set("memoryVerseRef", e.target.value)} maxLength={100} required placeholder="e.g. Malachi 3:10" />
      </label>

      <label className="check">
        <input type="checkbox" checked={form.status === "DRAFT"} onChange={(e) => set("status", e.target.checked ? "DRAFT" : "SCHEDULED")} /> Save as draft (not shown or sent)
      </label>
      <p className="hint">Scheduled challenges go live on Home and are pushed to everyone on Monday at 5:00 AM (Singapore).</p>

      <div className="row">
        <button type="button" className="btn secondary" onClick={onDone}>
          Cancel
        </button>
        <button className="btn" disabled={save.isPending}>
          {save.isPending ? "Saving…" : editing ? "Save changes" : form.status === "DRAFT" ? "Save draft" : "Schedule"}
        </button>
      </div>
      {save.isError && <p className="error-text">{save.error.message}</p>}
    </form>
  );
}

export function ChallengesAdmin() {
  const data = useAdminChallenges();
  const remove = useDeleteChallenge();
  const [editing, setEditing] = useState<AdminChallenge | "new" | null>(null);

  if (data.isPending) return <Loading />;
  if (data.isError) return <ErrorView error={data.error} onRetry={() => void data.refetch()} />;
  const { items, weeks } = data.data;
  const taken = new Set(items.map((c) => c.weekStart));
  const firstFree = weeks.find((w) => !taken.has(w.weekStart))?.weekStart;

  if (editing) {
    return (
      <ChallengeForm
        key={editing === "new" ? "new" : editing.id}
        initial={editing === "new" ? blank(firstFree ?? weeks[0].weekStart) : toInput(editing)}
        editing={editing === "new" ? undefined : editing}
        weeks={weeks}
        takenWeeks={taken}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <Section title={`Weekly challenges · ${items.length}/${weeks.length} weeks planned`} aside={firstFree && <button className="btn small" onClick={() => setEditing("new")}>+ New</button>}>
      <ul className="list">
        {items.map((c) => {
          const state = challengeState(c);
          return (
            <li key={c.id} className="card stack">
              <div className="row">
                <strong>
                  Week {c.weekNumber} · {c.title}
                </strong>
                <span className={`badge tone-${state.tone}`}>{state.label}</span>
              </div>
              <p className="hint">
                Mon {formatDay(c.weekStart)} · {c.financialInitiatives.join(" · ")} · {c.memoryVerseRef}
              </p>
              <div className="row">
                <button className="btn small secondary" onClick={() => setEditing(c)}>
                  Edit
                </button>
                <button
                  className="btn small danger"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (await confirmDialog(`Delete week ${c.weekNumber}'s challenge? Members will no longer see it.`)) remove.mutate(c.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li className="hint">No challenges yet. Schedule week 1 so it goes out on Monday at 5:00 AM.</li>}
      </ul>
      {remove.isError && <p className="error-text">{remove.error.message}</p>}
    </Section>
  );
}
