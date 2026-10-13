import { type FormEvent, useEffect, useState } from "react";
import { api, queryClient, useCellGroups, useMe, useUpdateMe } from "../api";
import type { Me } from "../api/types";
import { PageHeader, Section } from "../components/ui";
import { clearJournal, loadJournal, saveJournal } from "../lib/journal";
import { confirmDialog, haptic, tg } from "../telegram";

function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle">
      <span>
        <strong>{label}</strong>
        <span className="hint">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function CellGroupPicker({ me }: { me: Me }) {
  const cellGroups = useCellGroups();
  const update = useUpdateMe();
  if (me.cellGroup) {
    return (
      <p>
        Cell Group: <span className="badge">{me.cellGroup.code}</span> <span className="hint">(ask an admin to change it)</span>
      </p>
    );
  }
  return (
    <div className="stack">
      <p className="hint">Pick your Cell Group so your points count for your team. You can only choose once.</p>
      <div className="filters">
        {cellGroups.data?.map((cg) => (
          <button key={cg.id} className="chip" disabled={update.isPending} onClick={() => update.mutate({ cellGroupId: cg.id })}>
            {cg.code}
          </button>
        ))}
      </div>
      {update.isError && <p className="error-text">{update.error.message}</p>}
    </div>
  );
}

function Journal({ userId }: { userId: string }) {
  const [text, setText] = useState(() => loadJournal(userId));
  const [saved, setSaved] = useState<boolean | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSaved(saveJournal(userId, text)), 400);
    return () => clearTimeout(t);
  }, [userId, text]);
  return (
    <div className="stack">
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your private reflections…" aria-label="Private journal" />
      <p className="hint">🔐 Saved only on this device. Never uploaded. {saved === false && "⚠️ This device can't store it."}</p>
    </div>
  );
}

function PinSettings({ me }: { me: Me }) {
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (me.pinEnabled) await api.delete("/api/me/pin", { pin });
      else await api.put("/api/me/pin", { pin });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setMessage(me.pinEnabled ? "PIN removed." : "PIN set. You'll be asked for it each time you open the app.");
      setPin("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't update the PIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="row" onSubmit={submit}>
      <input
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        placeholder={me.pinEnabled ? "Current PIN" : "New 4–6 digit PIN"}
        aria-label="PIN"
      />
      <button className={`btn small${me.pinEnabled ? " secondary" : ""}`} disabled={busy || pin.length < 4}>
        {me.pinEnabled ? "Remove PIN" : "Set PIN"}
      </button>
      {message && <p className="hint">{message}</p>}
    </form>
  );
}

function DeleteMyData({ me }: { me: Me }) {
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    const ok = await confirmDialog(
      "Delete your data? Your name, points and settings are erased. Your posts and prayers stay, shown as “Former Member”. This can't be undone.",
    );
    if (!ok) return;
    try {
      await api.delete("/api/me", { confirm: "DELETE" });
      clearJournal(me.id);
      // Stop all queries: any further request would register the user again.
      queryClient.clear();
      haptic("success");
      setDeleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete your data.");
    }
  }

  if (deleted) {
    return (
      <div className="lock-screen" role="dialog">
        <h1>Your data has been deleted</h1>
        <p>Thank you for being part of the campaign.</p>
        <button className="btn" onClick={() => tg.close()}>
          Close
        </button>
      </div>
    );
  }
  return (
    <>
      <button className="btn danger block" onClick={() => void onDelete()}>
        Delete my data
      </button>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}

export function MePage() {
  const { data: me } = useMe();
  const update = useUpdateMe();
  if (!me) return null;

  return (
    <>
      <PageHeader title={me.name} subtitle={`${me.zone}${me.cellGroup ? ` · ${me.cellGroup.code}` : ""}${me.isAdmin ? " · Admin" : ""}`} />

      <Section>
        <div className="stats">
          <div>
            <p className="big">{me.points.total}</p>
            <p className="hint">points</p>
          </div>
          <div>
            <p className="big">{me.points.currentStreak}🔥</p>
            <p className="hint">day streak</p>
          </div>
          <div>
            <p className="big">{me.points.longestStreak}</p>
            <p className="hint">best streak</p>
          </div>
        </div>
      </Section>

      <Section title="Cell Group">
        <CellGroupPicker me={me} />
      </Section>

      <Section title="Privacy">
        <Toggle
          label="Stay Anonymous"
          hint="Hide my name on feeds and leave me off the individual leaderboard. My points still count for my Cell Group."
          checked={me.privacy.stayAnonymous}
          disabled={update.isPending}
          onChange={(v) => update.mutate({ stayAnonymous: v })}
        />
        <Toggle
          label="Show me on boards"
          hint="Only my Cell Group sees my real name on the leaderboard; others see “Anonymous”. Off: everyone sees my name."
          checked={me.privacy.showOnBoards}
          disabled={update.isPending || me.privacy.stayAnonymous}
          onChange={(v) => update.mutate({ showOnBoards: v })}
        />
        <Toggle
          label="Monday reminders"
          hint="The bot sends the new verse and challenge every Monday at 5:00 AM."
          checked={me.notificationsEnabled}
          disabled={update.isPending}
          onChange={(v) => update.mutate({ notificationsEnabled: v })}
        />
        {update.isError && <p className="error-text">{update.error.message}</p>}
      </Section>

      <Section title="Private Journal">
        <Journal userId={me.id} />
      </Section>

      <Section title="Security">
        <PinSettings me={me} />
      </Section>

      <Section title="Your data">
        <DeleteMyData me={me} />
      </Section>
    </>
  );
}
