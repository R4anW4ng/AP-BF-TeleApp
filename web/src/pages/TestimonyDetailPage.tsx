import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { useTestimony } from "../api";
import { TestimonyBody } from "../components/TestimonyBlocks";
import { ErrorView, Loading } from "../components/ui";
import { formatDate } from "../lib/format";
import { useBackButton } from "../telegram";

export function TestimonyDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  useBackButton(useCallback(() => void navigate("/testimonies"), [navigate]));
  const testimony = useTestimony(id);

  if (testimony.isPending) return <Loading />;
  if (testimony.isError) return <ErrorView error={testimony.error} />;
  const t = testimony.data;

  return (
    <article className="story">
      {t.coverUrl && <img className="cover" src={t.coverUrl} alt="" />}
      <h1>{t.title}</h1>
      {t.subtitle && <p className="subtitle">{t.subtitle}</p>}
      <p className="hint">
        {t.byline && `${t.byline} · `}
        {t.publishedAt ? formatDate(t.publishedAt) : "Draft"}
      </p>
      <TestimonyBody blocks={t.blocks} />
    </article>
  );
}
