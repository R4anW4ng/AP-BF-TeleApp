/** Error returned by the API: `{ error: { code, message, ...details } }`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The Telegram session can't be used any more; the user must reopen the Mini App. */
  get needsRelaunch(): boolean {
    return this.status === 401 || this.code === "NO_INIT_DATA";
  }
}

export interface ApiClientOptions {
  /** e.g. "https://api.example.org", or "" for same-origin. */
  baseUrl: string;
  /** Returns the raw signed `Telegram.WebApp.initData` string. */
  getInitData: () => string;
  fetch?: typeof fetch;
}

type Body = FormData | Record<string, unknown> | undefined;

/**
 * Thin fetch wrapper. Every request, JSON or multipart, carries
 * `Authorization: tma <initData>`, the header the server's HMAC middleware
 * expects. Callers can't forget it or send a different identity.
 */
export function createApiClient({ baseUrl, getInitData, fetch: fetchImpl = globalThis.fetch.bind(globalThis) }: ApiClientOptions) {
  async function request<T>(method: string, path: string, body?: Body, signal?: AbortSignal): Promise<T> {
    const initData = getInitData();
    if (!initData) {
      throw new ApiError(0, "NO_INIT_DATA", "Please open this app from the bot in Telegram.");
    }

    const headers = new Headers({ Authorization: `tma ${initData}`, Accept: "application/json" });
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body; // the browser sets the multipart boundary
    } else if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      payload = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: payload, signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.");
    }

    if (res.status === 204) return undefined as T;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`, err ?? {});
    }
    return data as T;
  }

  return {
    get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
    post: <T>(path: string, body?: Body) => request<T>("POST", path, body),
    put: <T>(path: string, body?: Body) => request<T>("PUT", path, body),
    patch: <T>(path: string, body?: Body) => request<T>("PATCH", path, body),
    delete: <T>(path: string, body?: Body) => request<T>("DELETE", path, body),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
