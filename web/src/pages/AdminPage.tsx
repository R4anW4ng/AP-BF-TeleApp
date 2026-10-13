import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { uploadImage, useDeleteTestimony, useSaveTestimony, useTestimonies } from "../api";
import type { TestimonyBlock } from "../api/types";
import { ErrorView, Loading, PageHeader, Section } from "../components/ui";
import { confirmDialog } from "../telegram";

/** Body text → blocks: blank lines separate paragraphs; a line starting with "# " is a heading. */
export function textToBlocks(body: string): TestimonyBlock[] {
  return body
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (chunk.startsWith("# ") ? { type: "heading", text: chunk.slice(2).trim() } : { type: "paragraph", text: chunk }));
}

function NewTestimonyForm() {
  const save = useSaveTestimony();
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [byline, setByline] = useState("");
  const [body, setBody] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [publish, setPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const coverMediaId = cover ? (await uploadImage(cover, "TESTIMONY")).id : null;
      await save.mutateAsync({
        input: { title, subtitle: subtitle || null, byline: byline || null, coverMediaId, blocks: textToBlocks(body), status: publish ? "PUBLISHED" : "DRAFT" },
      });
      setTitle("");
      setSubtitle("");
      setByline("");
      setBody("");
      setCover(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={200} aria-label="Title" />
      <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle (optional)" maxLength={300} aria-label="Subtitle" />
      <input value={byline} onChange={(e) => setByline(e.target.value)} placeholder="Byline, e.g. “A member of AP2” (optional)" maxLength={120} aria-label="Byline" />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        placeholder={"Story text. Leave a blank line between paragraphs.\n# A line like this becomes a heading."}
        aria-label="Story"
      />
      <label className="hint">
        Cover photo (optional) <input type="file" accept="image/*" onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
      </label>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish now
        </label>
        <button className="btn" disabled={busy || !title.trim() || !body.trim()}>
          {busy ? "Saving…" : publish ? "Publish" : "Save draft"}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

function TestimonyList() {
  const testimonies = useTestimonies(true);
  const remove = useDeleteTestimony();
  if (testimonies.isPending) return <Loading />;
  if (testimonies.isError) return <ErrorView error={testimonies.error} />;
  return (
    <ul className="list">
      {testimonies.data.map((t) => (
        <li key={t.id} className="row">
          <Link to={`/testimonies/${t.slug}`}>{t.title}</Link>
          <span className={`badge${t.status === "PUBLISHED" ? "" : " muted"}`}>{t.status.toLowerCase()}</span>
          <button
            className="btn small danger"
            disabled={remove.isPending}
            onClick={async () => {
              if (await confirmDialog(`Delete “${t.title}”? This can't be undone.`)) remove.mutate(t.id);
            }}
          >
            Delete
          </button>
        </li>
      ))}
      {testimonies.data.length === 0 && <li className="hint">No testimonies yet.</li>}
    </ul>
  );
}

export function AdminPage() {
  return (
    <>
      <PageHeader title="Admin" subtitle="Only admins can see this tab" />
      <Section title="New testimony">
        <NewTestimonyForm />
      </Section>
      <Section title="Testimonies">
        <TestimonyList />
      </Section>
      <Section title="Coming in Phase 5">
        <ul className="list hint">
          <li>Schedule weekly challenges and memory verses</li>
          <li>Set the monthly spiritual goal</li>
          <li>Promote members to admin</li>
          <li>Leaderboards</li>
        </ul>
      </Section>
    </>
  );
}
