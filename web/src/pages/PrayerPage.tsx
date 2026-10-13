import { type FormEvent, useState } from "react";
import { useAddComment, useCreatePrayer, usePrayers, useToggleReaction } from "../api";
import type { Prayer, ReactionType } from "../api/types";
import { AuthorLine, ErrorView, LoadMore, Loading, PageHeader, Section } from "../components/ui";
import { timeAgo } from "../lib/format";

const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: "HEART", emoji: "❤️", label: "Love" },
  { type: "PRAYING", emoji: "🙏", label: "Praying" },
  { type: "AMEN", emoji: "🙌", label: "Amen" },
  { type: "HUG", emoji: "🤗", label: "Hug" },
];

function Composer() {
  const create = useCreatePrayer();
  const [content, setContent] = useState("");
  const [isAnonymous, setAnonymous] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ content, isAnonymous }, { onSuccess: () => setContent("") });
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Share a prayer request…"
        maxLength={2000}
        rows={3}
        aria-label="Prayer request"
      />
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={isAnonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Post anonymously
        </label>
        <button className="btn" disabled={!content.trim() || create.isPending}>
          {create.isPending ? "Posting…" : "Post"}
        </button>
      </div>
      {create.isError && <p className="error-text">{create.error.message}</p>}
    </form>
  );
}

function CommentForm({ prayerId }: { prayerId: string }) {
  const add = useAddComment();
  const [content, setContent] = useState("");
  return (
    <form
      className="row comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate({ prayerId, content, isAnonymous: false }, { onSuccess: () => setContent("") });
      }}
    >
      <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write an encouragement…" maxLength={1000} aria-label="Comment" />
      <button className="btn small" disabled={!content.trim() || add.isPending}>
        Send
      </button>
    </form>
  );
}

function PrayerCard({ prayer }: { prayer: Prayer }) {
  const toggle = useToggleReaction();
  const [open, setOpen] = useState(false);

  return (
    <article className="card">
      <header className="post-meta">
        <AuthorLine author={prayer.author} cellGroup={prayer.cellGroup} />
        <time dateTime={prayer.createdAt}>{timeAgo(prayer.createdAt)}</time>
      </header>
      <p className="post-body">{prayer.content}</p>

      <div className="reactions">
        {REACTIONS.map((r) => {
          const mine = prayer.reactions.mine.includes(r.type);
          return (
            <button
              key={r.type}
              className={`chip${mine ? " selected" : ""}`}
              aria-pressed={mine}
              aria-label={r.label}
              onClick={() => toggle.mutate({ prayerId: prayer.id, type: r.type })}
            >
              {r.emoji} {prayer.reactions.counts[r.type] || ""}
            </button>
          );
        })}
        <button className="chip" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          💬 {prayer.commentCount || ""}
        </button>
      </div>

      {open && (
        <div className="comments">
          {prayer.comments.map((c) => (
            <div key={c.id} className="comment">
              <AuthorLine author={c.author} /> <span className="hint">{timeAgo(c.createdAt)}</span>
              <p>{c.content}</p>
            </div>
          ))}
          <CommentForm prayerId={prayer.id} />
        </div>
      )}
    </article>
  );
}

export function PrayerPage() {
  const prayers = usePrayers();

  return (
    <>
      <PageHeader title="Prayer Wall" subtitle="Carry each other's burdens" />
      <Composer />
      <Section>
        {prayers.isPending ? (
          <Loading />
        ) : prayers.isError ? (
          <ErrorView error={prayers.error} onRetry={() => void prayers.refetch()} />
        ) : (
          <div className="feed">
            {prayers.data.pages.flatMap((p) => p.items).map((prayer) => (
              <PrayerCard key={prayer.id} prayer={prayer} />
            ))}
            {prayers.data.pages[0].items.length === 0 && <p className="hint">No prayer requests yet. Be the first.</p>}
            <LoadMore hasMore={prayers.hasNextPage} loading={prayers.isFetchingNextPage} onClick={() => void prayers.fetchNextPage()} />
          </div>
        )}
      </Section>
    </>
  );
}
