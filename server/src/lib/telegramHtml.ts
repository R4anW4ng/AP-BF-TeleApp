/** Escape text for Telegram `parse_mode: "HTML"`. Only &, < and > are special. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Shorten admin-entered text so a message stays well under Telegram's 4096-char limit. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
