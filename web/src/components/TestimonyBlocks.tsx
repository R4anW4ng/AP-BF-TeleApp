import type { TestimonyBlock } from "../api/types";

/**
 * Renders testimony content as plain elements: there is no HTML injection path.
 * Shared by the reader and the admin editor's live preview.
 */
export function TestimonyBlockView({ block }: { block: TestimonyBlock }) {
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

export function TestimonyBody({ blocks }: { blocks: TestimonyBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <TestimonyBlockView key={i} block={block} />
      ))}
    </>
  );
}
