import WebAppImport from "@twa-dev/sdk";
import type { WebApp as TelegramWebApp } from "@twa-dev/types";
import { useEffect } from "react";

/**
 * The Telegram Mini App bridge. `@twa-dev/sdk` loads Telegram's official
 * telegram-web-app.js, which parses the launch parameters from the URL hash
 * and exposes `window.Telegram.WebApp`.
 *
 * The package is CommonJS: in the production bundle its default import arrives
 * as the module object (`{ default: WebApp }`), not the WebApp itself, so unwrap it.
 */
const sdk = WebAppImport as unknown as TelegramWebApp & { default?: TelegramWebApp };
export const tg: TelegramWebApp = sdk.default ?? sdk;

/**
 * The raw, signed initData string Telegram passed at launch. This is what the
 * server verifies with HMAC-SHA256.
 *
 * We never use `tg.initDataUnsafe` for authentication: it's an unsigned,
 * parsed copy that page code could modify. The only thing the client may do
 * with initData is forward it untouched.
 *
 * Outside Telegram (plain browser) it is empty. In `vite dev` only, a value
 * signed by your own server can be supplied through VITE_DEV_INIT_DATA.
 */
export function getInitData(): string {
  if (tg.initData) return tg.initData;
  if (import.meta.env.DEV) return import.meta.env.VITE_DEV_INIT_DATA ?? "";
  return "";
}

export function isInsideTelegram(): boolean {
  return Boolean(tg.initData);
}

/** Call once on mount: tell Telegram we're ready (hides its loader) and use the full height. */
export function useTelegramInit(onActivated?: () => void): void {
  useEffect(() => {
    tg.ready();
    tg.expand();
    if (!onActivated) return;
    // Fired when the user returns to an already-open Mini App (Bot API 8.0+).
    const on = tg.onEvent as (event: string, cb: () => void) => void;
    const off = tg.offEvent as (event: string, cb: () => void) => void;
    on("activated", onActivated);
    return () => off("activated", onActivated);
  }, [onActivated]);
}

/** Show Telegram's native Back button while the calling page is mounted. */
export function useBackButton(onBack: () => void): void {
  useEffect(() => {
    if (!tg.isVersionAtLeast("6.1")) return;
    tg.BackButton.show();
    tg.BackButton.onClick(onBack);
    return () => {
      tg.BackButton.offClick(onBack);
      tg.BackButton.hide();
    };
  }, [onBack]);
}

/** Native confirm dialog in Telegram, browser confirm elsewhere. */
export function confirmDialog(message: string): Promise<boolean> {
  if (isInsideTelegram() && tg.isVersionAtLeast("6.2")) {
    return new Promise((resolve) => tg.showConfirm(message, (ok) => resolve(ok)));
  }
  return Promise.resolve(window.confirm(message));
}

export function haptic(kind: "success" | "error" | "warning"): void {
  if (isInsideTelegram() && tg.isVersionAtLeast("6.1")) tg.HapticFeedback.notificationOccurred(kind);
}
