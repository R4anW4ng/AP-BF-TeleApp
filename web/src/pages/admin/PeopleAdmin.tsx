import { useEffect, useState } from "react";
import { useCellGroups } from "../../api";
import { usePeople, useUpdatePerson } from "../../api/admin";
import type { Person } from "../../api/types";
import { ErrorView, Loading, Section } from "../../components/ui";
import { confirmDialog, haptic } from "../../telegram";

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function PersonRow({ person }: { person: Person }) {
  const update = useUpdatePerson();
  const cellGroups = useCellGroups();
  const isAdmin = person.role === "ADMIN";
  const locked = isAdmin && (person.isMe || person.isWhitelisted);

  async function toggleRole() {
    const ok = await confirmDialog(
      isAdmin ? `Remove admin access from ${person.name}?` : `Make ${person.name} an admin? They'll be able to schedule challenges, publish testimonies and manage people.`,
    );
    if (ok) update.mutate({ id: person.id, role: isAdmin ? "USER" : "ADMIN" }, { onSuccess: () => haptic("success") });
  }

  return (
    <li className="card stack">
      <div className="row">
        <span>
          <strong>{person.name}</strong>
          {person.isMe && " (you)"} {person.username && <span className="hint">@{person.username}</span>}
        </span>
        <span className={`badge${isAdmin ? " tone-live" : ""}`}>{isAdmin ? "Admin" : "Member"}</span>
      </div>
      <div className="row">
        <label className="hint">
          Cell Group{" "}
          <select
            value={person.cellGroup?.id ?? ""}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ id: person.id, cellGroupId: e.target.value || null })}
            aria-label={`Cell Group for ${person.name}`}
          >
            <option value="">None</option>
            {cellGroups.data?.map((cg) => (
              <option key={cg.id} value={cg.id}>
                {cg.code}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          {person.points} pts{person.stayAnonymous ? " · anonymous" : ""}
        </span>
        <button className={`btn small${isAdmin ? " secondary" : ""}`} disabled={locked || update.isPending} onClick={() => void toggleRole()}>
          {isAdmin ? "Remove admin" : "Make admin"}
        </button>
      </div>
      {locked && <p className="hint">{person.isMe ? "You can't remove your own admin role." : "Set in ADMIN_TELEGRAM_IDS on the server."}</p>}
      {update.isError && <p className="error-text">{update.error.message}</p>}
    </li>
  );
}

export function PeopleAdmin() {
  const [query, setQuery] = useState("");
  const people = usePeople(useDebounced(query.trim()));

  return (
    <Section title="People">
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or @username" aria-label="Search people" />
      <p className="hint">Admins see real names here so they can manage roles and Cell Groups. Moving someone moves their points to the new group.</p>
      {people.isPending ? (
        <Loading />
      ) : people.isError ? (
        <ErrorView error={people.error} onRetry={() => void people.refetch()} />
      ) : (
        <ul className="list">
          {people.data.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
          {people.data.length === 0 && <li className="hint">No one matches “{query}”.</li>}
        </ul>
      )}
    </Section>
  );
}
