import { type FormEvent, type ReactNode, useState } from "react";
import { api, ApiError } from "../api";
import { haptic } from "../telegram";

/**
 * When the user has an app PIN, ask for it once per app launch before showing
 * anything. The PIN is checked by the server (with lockout after 5 wrong tries).
 * Forgot it? /resetpin in the bot chat removes it.
 */
export function PinGate({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!enabled || unlocked) return <>{children}</>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/me/pin/verify", { pin });
      haptic("success");
      setUnlocked(true);
    } catch (err) {
      haptic("error");
      setPin("");
      if (err instanceof ApiError && err.code === "PIN_INCORRECT") {
        setError(`Incorrect PIN. ${String(err.details.attemptsRemaining)} attempt(s) left.`);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't check your PIN.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lock-screen">
      <h1>🔒 Enter your PIN</h1>
      <form onSubmit={submit} className="stack">
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{4,6}"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          aria-label="PIN"
          autoFocus
        />
        <button className="btn" disabled={busy || pin.length < 4}>
          Unlock
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
      <p className="hint">Forgot it? Send /resetpin to the bot.</p>
    </div>
  );
}
