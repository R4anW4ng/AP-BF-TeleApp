import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { useTestimony } from "../api";
import type { TestimonyBlock } from "../api/types";
import { ErrorView, Loading } from "../components/ui";
import { formatDate } from "../lib/format";
import { useBackButton } from "../telegram";

/** Blocks are rendered as plain elements; there is no HTML injection path. Read-only: no comments or reactions. */
function Block({ block }: { block: TestimonyBlock }) {
  switch (block.type) {
    case "heading":
      return <h2>{block.text}</h2>;
    case "paragraph":
      return <p>{block.text}</p>;
    case "quote":
      return (
        <blockquote className="verse">
          {block.text}
          {block.cite && <cite>{block.cite}</cite>}
        </blockquote>
      );
    case "image":
      return block.url ? (
        <figure>
          <img src={block.url} alt={block.caption ?? ""} loading="lazy" width={block.width ?? undefined} height={block.height ?? undefined} />
          {block.caption && <figcaption className="hint">{block.caption}</figcaption>}
        </figure>
      ) : null;
  }
}

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
      {t.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </article>
  );
}
