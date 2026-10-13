import type { ReactNode } from "react";
import { ApiError, useMe } from "../api";
import { tg } from "../telegram";
import { PinGate } from "./PinGate";
import { ErrorView, Loading } from "./ui";

/**
 * Nothing renders until GET /api/me succeeds, i.e. until the server has
 * verified this launch's initData. Handles "not opened from Telegram",
 * expired sessions and the PIN lock.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isPending) return <Loading label="Signing you in…" />;

  if (me.isError) {
    const err = me.error;
    if (err instanceof ApiError && err.needsRelaunch) {
      return (
        <div className="lock-screen">
          <h1>Open from Telegram</h1>
          <p>{err.code === "INIT_DATA_EXPIRED" ? "Your session has expired." : err.message}</p>
          <p className="hint">Close this window and tap “Open Building Fund app” in the bot chat.</p>
          {tg.initData && (
            <button className="btn" onClick={() => tg.close()}>
              Close
            </button>
          )}
        </div>
      );
    }
    return <ErrorView error={err} onRetry={() => void me.refetch()} />;
  }

  return <PinGate enabled={me.data.pinEnabled}>{children}</PinGate>;
}
