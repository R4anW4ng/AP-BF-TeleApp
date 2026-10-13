import { type ChangeEvent, useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { uploadImage, useSaveTestimony, useTestimony } from "../../api";
import type { Testimony, TestimonyBlock } from "../../api/types";
import { TestimonyBody } from "../../components/TestimonyBlocks";
import { ErrorView, Loading } from "../../components/ui";
import { type EditorBlock, emptyBlock, moveBlock, textToBlocks, toPayloadBlocks, withKeys } from "../../lib/blocks";
import { haptic, useBackButton } from "../../telegram";

const BLOCK_LABELS: Record<TestimonyBlock["type"], string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  quote: "Quote / verse",
  image: "Photo",
};

interface Draft {
  title: string;
  subtitle: string;
  byline: string;
  cover: { mediaId: string; url: string | null } | null;
  published: boolean;
  blocks: EditorBlock[];
}

function fromTestimony(t?: Testimony): Draft {
  if (!t) return { title: "", subtitle: "", byline: "", cover: null, published: false, blocks: withKeys([{ type: "paragraph", text: "" }]) };
  return {
    title: t.title,
    subtitle: t.subtitle ?? "",
    byline: t.byline ?? "",
    cover: t.coverMediaId ? { mediaId: t.coverMediaId, url: t.coverUrl } : null,
    published: t.status === "PUBLISHED",
    blocks: withKeys(t.blocks),
  };
}

/** Upload one photo as a TESTIMONY image; returns its id and URL. */
function usePhotoUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return null;
    setUploading(true);
    setError(null);
    try {
      return await uploadImage(file, "TESTIMONY");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      return null;
    } finally {
      setUploading(false);
    }
  }, []);
  return { upload, uploading, error };
}

function BlockEditor({
  block,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  block: EditorBlock;
  index: number;
  count: number;
  onChange: (b: EditorBlock) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const photo = usePhotoUpload();
  return (
    <div className="card stack block-editor">
      <div className="row">
        <span className="badge">{BLOCK_LABELS[block.type]}</span>
        <span className="row">
          <button type="button" className="btn small secondary" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="btn small secondary" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
            ↓
          </button>
          <button type="button" className="btn small danger" onClick={onRemove} aria-label="Remove block">
            ✕
          </button>
        </span>
      </div>

      {block.type === "heading" && (
        <input value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} maxLength={200} placeholder="Section heading" aria-label="Heading text" />
      )}
      {block.type === "paragraph" && (
        <textarea value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} maxLength={5000} rows={5} placeholder="Write the story…" aria-label="Paragraph text" />
      )}
      {block.type === "quote" && (
        <>
          <textarea value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} maxLength={1000} rows={2} placeholder="Quote or Bible verse" aria-label="Quote text" />
          <input value={block.cite ?? ""} onChange={(e) => onChange({ ...block, cite: e.target.value })} maxLength={200} placeholder="Reference, e.g. Philippians 4:19" aria-label="Quote reference" />
        </>
      )}
      {block.type === "image" && (
        <>
          {block.url ? <img src={block.url} alt="" /> : <p className="hint">{photo.uploading ? "Uploading…" : "Choose a photo"}</p>}
          <input
            type="file"
            accept="image/*"
            aria-label="Photo file"
            disabled={photo.uploading}
            onChange={async (e) => {
              const img = await photo.upload(e);
              if (img) onChange({ ...block, mediaId: img.id, url: img.url, width: img.width, height: img.height });
            }}
          />
          <input value={block.caption ?? ""} onChange={(e) => onChange({ ...block, caption: e.target.value })} maxLength={300} placeholder="Caption (optional)" aria-label="Photo caption" />
          {photo.error && <p className="error-text">{photo.error}</p>}
        </>
      )}
    </div>
  );
}

function Editor({ existing }: { existing?: Testimony }) {
  const navigate = useNavigate();
  const save = useSaveTestimony();
  const cover = usePhotoUpload();
  const [draft, setDraft] = useState<Draft>(() => fromTestimony(existing));
  const [preview, setPreview] = useState(false);
  const [paste, setPaste] = useState("");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setBlocks = (fn: (b: EditorBlock[]) => EditorBlock[]) => setDraft((d) => ({ ...d, blocks: fn(d.blocks) }));

  const payloadBlocks = toPayloadBlocks(draft.blocks);
  const canSave = draft.title.trim() !== "" && payloadBlocks.length > 0 && !cover.uploading;

  async function submit(published: boolean) {
    await save.mutateAsync({
      id: existing?.id,
      input: {
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim() || null,
        byline: draft.byline.trim() || null,
        coverMediaId: draft.cover?.mediaId ?? null,
        blocks: payloadBlocks,
        status: published ? "PUBLISHED" : "DRAFT",
      },
    });
    haptic("success");
    navigate("/admin/testimonies");
  }

  if (preview) {
    return (
      <>
        <div className="row">
          <button className="btn secondary" onClick={() => setPreview(false)}>
            ← Back to editing
          </button>
          <span className="badge">Preview</span>
        </div>
        <article className="story">
          {draft.cover?.url && <img className="cover" src={draft.cover.url} alt="" />}
          <h1>{draft.title || "Untitled"}</h1>
          {draft.subtitle && <p className="subtitle">{draft.subtitle}</p>}
          {draft.byline && <p className="hint">{draft.byline}</p>}
          <TestimonyBody blocks={draft.blocks} />
        </article>
      </>
    );
  }

  return (
    <div className="stack">
      <div className="card stack">
        <h3>{existing ? "Edit testimony" : "New testimony"}</h3>
        <input value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={200} placeholder="Title" aria-label="Title" />
        <input value={draft.subtitle} onChange={(e) => set("subtitle", e.target.value)} maxLength={300} placeholder="Subtitle (optional)" aria-label="Subtitle" />
        <input value={draft.byline} onChange={(e) => set("byline", e.target.value)} maxLength={120} placeholder="Byline, e.g. “A family in AP2” (optional)" aria-label="Byline" />
        <div className="stack">
          <span className="hint">Cover photo (optional)</span>
          {draft.cover?.url && <img src={draft.cover.url} alt="" />}
          <div className="row">
            <input
              type="file"
              accept="image/*"
              aria-label="Cover photo"
              disabled={cover.uploading}
              onChange={async (e) => {
                const img = await cover.upload(e);
                if (img) set("cover", { mediaId: img.id, url: img.url });
              }}
            />
            {draft.cover && (
              <button type="button" className="btn small secondary" onClick={() => set("cover", null)}>
                Remove cover
              </button>
            )}
          </div>
          {cover.uploading && <p className="hint">Uploading…</p>}
          {cover.error && <p className="error-text">{cover.error}</p>}
        </div>
      </div>

      {draft.blocks.map((block, i) => (
        <BlockEditor
          key={block.key}
          block={block}
          index={i}
          count={draft.blocks.length}
          onChange={(b) => setBlocks((bs) => bs.map((x) => (x.key === block.key ? b : x)))}
          onMove={(dir) => setBlocks((bs) => moveBlock(bs, i, dir))}
          onRemove={() => setBlocks((bs) => bs.filter((x) => x.key !== block.key))}
        />
      ))}

      <div className="card stack">
        <span className="hint">Add a block</span>
        <div className="filters">
          {(Object.keys(BLOCK_LABELS) as TestimonyBlock["type"][]).map((type) => (
            <button key={type} type="button" className="chip" onClick={() => setBlocks((bs) => [...bs, emptyBlock(type)])}>
              + {BLOCK_LABELS[type]}
            </button>
          ))}
        </div>
        <details>
          <summary className="hint">Paste a whole story</summary>
          <div className="stack">
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder={"Blank lines separate paragraphs.\n# A line like this becomes a heading."} aria-label="Paste story" />
            <button
              type="button"
              className="btn small secondary"
              disabled={!paste.trim()}
              onClick={() => {
                setBlocks((bs) => [...bs.filter((b) => b.type !== "paragraph" || b.text.trim()), ...withKeys(textToBlocks(paste))]);
                setPaste("");
              }}
            >
              Add as blocks
            </button>
          </div>
        </details>
      </div>

      <div className="row sticky-actions">
        <button type="button" className="btn secondary" onClick={() => setPreview(true)}>
          Preview
        </button>
        <span className="row">
          <button type="button" className="btn secondary" disabled={!canSave || save.isPending} onClick={() => void submit(false).catch(() => {})}>
            Save draft
          </button>
          <button type="button" className="btn" disabled={!canSave || save.isPending} onClick={() => void submit(true).catch(() => {})}>
            {save.isPending ? "Saving…" : existing?.status === "PUBLISHED" ? "Update" : "Publish"}
          </button>
        </span>
      </div>
      {save.isError && <p className="error-text">{save.error.message}</p>}
    </div>
  );
}

/** /admin/testimonies/new and /admin/testimonies/:id/edit */
export function TestimonyEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  useBackButton(useCallback(() => void navigate("/admin/testimonies"), [navigate]));
  if (!id) return <Editor />;
  return <ExistingEditor id={id} />;
}

function ExistingEditor({ id }: { id: string }) {
  const testimony = useTestimony(id);
  if (testimony.isPending) return <Loading />;
  if (testimony.isError) return <ErrorView error={testimony.error} />;
  return <Editor key={testimony.data.updatedAt} existing={testimony.data} />;
}
