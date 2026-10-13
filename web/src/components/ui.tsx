import type { ReactNode } from "react";
import { ApiError } from "../api";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="status" role="status">
      {label}
    </div>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="status error" role="alert">
      <p>{message}</p>
      {onRetry && !(error instanceof ApiError && error.needsRelaunch) && (
        <button className="btn secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Section({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      {(title || aside) && (
        <header className="section-header">
          {title && <h2>{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {subtitle && <p className="hint">{subtitle}</p>}
    </header>
  );
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <button className="btn secondary block" disabled={loading} onClick={onClick}>
      {loading ? "Loading…" : "Load more"}
    </button>
  );
}

/** "Grace Tan · AP1", "You (anonymous) · AP2", "Former Member". */
export function AuthorLine({ author, cellGroup }: { author: { name: string; isMe: boolean; isAnonymous: boolean }; cellGroup?: { code: string } | null }) {
  const name = author.isMe ? `You${author.isAnonymous ? " (anonymous)" : ""}` : author.name;
  return (
    <span className="author">
      <strong>{name}</strong>
      {cellGroup && <span className="badge">{cellGroup.code}</span>}
    </span>
  );
}
