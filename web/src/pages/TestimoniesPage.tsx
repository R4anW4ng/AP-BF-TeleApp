import { Link } from "react-router";
import { useTestimonies } from "../api";
import { ErrorView, Loading, PageHeader } from "../components/ui";
import { formatDate } from "../lib/format";

export function TestimoniesPage() {
  const testimonies = useTestimonies();

  return (
    <>
      <PageHeader title="Testimonies" subtitle="Stories of God's faithfulness" />
      {testimonies.isPending ? (
        <Loading />
      ) : testimonies.isError ? (
        <ErrorView error={testimonies.error} onRetry={() => void testimonies.refetch()} />
      ) : testimonies.data.length === 0 ? (
        <p className="hint">The first stories are on their way.</p>
      ) : (
        <div className="feed">
          {testimonies.data.map((t) => (
            <Link key={t.id} to={`/testimonies/${t.slug}`} className="card story-card">
              {t.coverUrl && <img src={t.coverUrl} alt="" loading="lazy" />}
              <h3>{t.title}</h3>
              {t.subtitle && <p className="hint">{t.subtitle}</p>}
              {t.excerpt && <p>{t.excerpt}</p>}
              <p className="hint">
                {t.byline && `${t.byline} · `}
                {t.publishedAt && formatDate(t.publishedAt)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
