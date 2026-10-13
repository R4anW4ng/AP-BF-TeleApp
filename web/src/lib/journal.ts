/**
 * Private Journal: stored ONLY in this device's localStorage, never sent to the
 * server. Keyed per user so two accounts on one phone don't share a journal.
 * Storage can be unavailable (private mode, cleared data), so every access is guarded.
 */
const keyFor = (userId: string) => `apbf:journal:${userId}`;

export function loadJournal(userId: string): string {
  try {
    return localStorage.getItem(keyFor(userId)) ?? "";
  } catch {
    return "";
  }
}

export function saveJournal(userId: string, text: string): boolean {
  try {
    localStorage.setItem(keyFor(userId), text);
    return true;
  } catch {
    return false;
  }
}

export function clearJournal(userId: string): void {
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    // nothing to clear
  }
}
