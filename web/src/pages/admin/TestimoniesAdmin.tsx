import { Link } from "react-router";
import { useDeleteTestimony, useTestimonies } from "../../api";
import { ErrorView, Loading, Section } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { confirmDialog } from "../../telegram";

export function TestimoniesAdmin() {
  const testimonies = useTestimonies(true);
  const remove = useDeleteTestimony();

  return (
    <Section title="Testimonies" aside={<Link className="btn small" to="new">+ New</Link>}>
      {testimonies.isPending ? (
        <Loading />
      ) : testimonies.isError ? (
        <ErrorView error={testimonies.error} onRetry={() => void testimonies.refetch()} />
      ) : (
        <ul className="list">
          {testimonies.data.map((t) => (
            <li key={t.id} className="card stack">
              <div className="row">
                <strong>{t.title}</strong>
                <span className={`badge${t.status === "PUBLISHED" ? " tone-live" : " muted"}`}>
                  {t.status === "PUBLISHED" ? `Published${t.publishedAt ? ` ${formatDate(t.publishedAt)}` : ""}` : "Draft"}
                </span>
              </div>
              <div className="row">
                <Link className="btn small secondary" to={`/testimonies/${t.slug}`}>
                  View
                </Link>
                <Link className="btn small secondary" to={`${t.id}/edit`}>
                  Edit
                </Link>
                <button
                  className="btn small danger"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (await confirmDialog(`Delete “${t.title}” and its photos? This can't be undone.`)) remove.mutate(t.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {testimonies.data.length === 0 && <li className="hint">No testimonies yet.</li>}
        </ul>
      )}
    </Section>
  );
}
