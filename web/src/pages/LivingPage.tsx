import { type FormEvent, useRef, useState } from "react";
import { useCellGroups, useCreateLiving, useLiving } from "../api";
import type { LivingPost } from "../api/types";
import { AuthorLine, ErrorView, LoadMore, Loading, PageHeader, Section } from "../components/ui";
import { timeAgo } from "../lib/format";
import { haptic } from "../telegram";

const MAX_IMAGES = 4;

function Composer() {
  const create = useCreateLiving();
  const [content, setContent] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [isAnonymous, setAnonymous] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { content, isAnonymous, images },
      {
        onSuccess: () => {
          haptic("success");
          setContent("");
          setImages([]);
          if (fileInput.current) fileInput.current.value = "";
        },
      },
    );
  }

  const result = create.data?.points;
  return (
    <form className="card stack" onSubmit={submit}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="How did you sacrifice this week? (e.g. DIY coffee instead of Starbucks)"
        maxLength={2000}
        rows={3}
        aria-label="Your story"
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        aria-label="Photos"
        onChange={(e) => setImages(Array.from(e.target.files ?? []).slice(0, MAX_IMAGES))}
      />
      {images.length > 0 && <p className="hint">{images.length} photo(s) selected (max {MAX_IMAGES})</p>}
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={isAnonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Post anonymously
        </label>
        <button className="btn" disabled={!content.trim() || create.isPending}>
          {create.isPending ? "Sharing…" : "Share"}
        </button>
      </div>
      {create.isError && <p className="error-text">{create.error.message}</p>}
      {result && (
        <p className="hint">{result.awarded ? `Shared! +${result.points} points` : "Shared! (Today's 2 post bonuses are already earned.)"}</p>
      )}
    </form>
  );
}

function PostCard({ post }: { post: LivingPost }) {
  return (
    <article className="card">
      <header className="post-meta">
        <AuthorLine author={post.author} cellGroup={post.cellGroup} />
        <span className="hint">
          {post.weekNumber > 0 ? `Week ${post.weekNumber}` : "Pre-launch"} · <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
        </span>
      </header>
      {post.images.length > 0 && (
        <div className={`photos n${post.images.length}`}>
          {post.images.map((img) =>
            img.url ? <img key={img.id} src={img.url} alt="" loading="lazy" width={img.width ?? undefined} height={img.height ?? undefined} /> : null,
          )}
        </div>
      )}
      <p className="post-body">{post.content}</p>
    </article>
  );
}

export function LivingPage() {
  const [zone, setZone] = useState("ALL");
  const cellGroups = useCellGroups();
  const posts = useLiving(zone);

  return (
    <>
      <PageHeader title="Living it Out" subtitle="Practical sacrifices from the zone" />
      <Composer />
      <div className="filters" role="tablist" aria-label="Filter by Cell Group">
        {["ALL", ...(cellGroups.data?.map((cg) => cg.code) ?? [])].map((code) => (
          <button key={code} role="tab" aria-selected={zone === code} className={`chip${zone === code ? " selected" : ""}`} onClick={() => setZone(code)}>
            {code === "ALL" ? "All" : code}
          </button>
        ))}
      </div>
      <Section>
        {posts.isPending ? (
          <Loading />
        ) : posts.isError ? (
          <ErrorView error={posts.error} onRetry={() => void posts.refetch()} />
        ) : (
          <div className="feed">
            {posts.data.pages.flatMap((p) => p.items).map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
            {posts.data.pages[0].items.length === 0 && <p className="hint">No posts here yet.</p>}
            <LoadMore hasMore={posts.hasNextPage} loading={posts.isFetchingNextPage} onClick={() => void posts.fetchNextPage()} />
          </div>
        )}
      </Section>
    </>
  );
}
