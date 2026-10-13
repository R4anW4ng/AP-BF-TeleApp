import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client";

const INIT_DATA = "query_id=AAH&user=%7B%22id%22%3A42%7D&auth_date=1760000000&hash=abc123";

function setup(response: Response | (() => Response) = new Response(JSON.stringify({ ok: true }), { status: 200 })) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => (typeof response === "function" ? response() : response.clone()));
  const getInitData = vi.fn(() => INIT_DATA);
  const api = createApiClient({ baseUrl: "https://api.example.org", getInitData, fetch: fetch as unknown as typeof globalThis.fetch });
  const call = (i = 0) => {
    const [url, init] = fetch.mock.calls[i];
    return { url, init: init!, headers: new Headers(init!.headers) };
  };
  return { api, fetch, getInitData, call };
}

describe("API client initData injection", () => {
  it("sends `Authorization: tma <raw initData>` on GET", async () => {
    const { api, call } = setup();
    await api.get("/api/me");
    expect(call().url).toBe("https://api.example.org/api/me");
    expect(call().headers.get("Authorization")).toBe(`tma ${INIT_DATA}`);
  });

  it("sends it on JSON writes, with a JSON body", async () => {
    const { api, call } = setup();
    await api.post("/api/prayers", { content: "hi", isAnonymous: false });
    expect(call().init.method).toBe("POST");
    expect(call().headers.get("Authorization")).toBe(`tma ${INIT_DATA}`);
    expect(call().headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(call().init.body as string)).toEqual({ content: "hi", isAnonymous: false });
  });

  it("sends it on multipart uploads and lets the browser set the boundary", async () => {
    const { api, call } = setup();
    const form = new FormData();
    form.set("content", "DIY coffee");
    await api.post("/api/living", form);
    expect(call().headers.get("Authorization")).toBe(`tma ${INIT_DATA}`);
    expect(call().headers.get("Content-Type")).toBeNull();
    expect(call().init.body).toBe(form);
  });

  it("reads initData for every request (never caches a stale value)", async () => {
    const { api, getInitData } = setup();
    await api.get("/a");
    await api.delete("/b", { confirm: "DELETE" });
    expect(getInitData).toHaveBeenCalledTimes(2);
  });

  it("refuses to call the API without initData (opened outside Telegram)", async () => {
    const fetch = vi.fn();
    const api = createApiClient({ baseUrl: "", getInitData: () => "", fetch });
    await expect(api.get("/api/me")).rejects.toMatchObject({ code: "NO_INIT_DATA", needsRelaunch: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns server errors into ApiError with code and details", async () => {
    const body = { error: { code: "PIN_INCORRECT", message: "Incorrect PIN", attemptsRemaining: 3 } };
    const { api } = setup(() => new Response(JSON.stringify(body), { status: 403 }));
    const err = await api.post("/api/me/pin/verify", { pin: "0000" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "PIN_INCORRECT", message: "Incorrect PIN", details: { attemptsRemaining: 3 } });
  });

  it("flags expired initData as needing a relaunch", async () => {
    const body = { error: { code: "INIT_DATA_EXPIRED", message: "initData has expired" } };
    const { api } = setup(() => new Response(JSON.stringify(body), { status: 401 }));
    await expect(api.get("/api/me")).rejects.toMatchObject({ needsRelaunch: true, code: "INIT_DATA_EXPIRED" });
  });

  it("handles 204 and network failures", async () => {
    expect(await setup(() => new Response(null, { status: 204 })).api.delete("/api/me", { confirm: "DELETE" })).toBeUndefined();
    const api = createApiClient({ baseUrl: "", getInitData: () => INIT_DATA, fetch: () => Promise.reject(new TypeError("Failed to fetch")) });
    await expect(api.get("/x")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("getInitData", () => {
  it("returns Telegram.WebApp.initData, not initDataUnsafe", async () => {
    vi.resetModules();
    const fake = { initData: INIT_DATA, initDataUnsafe: { user: { id: 1000, first_name: "Spoofed" } } };
    vi.doMock("@twa-dev/sdk", () => ({ default: fake }));
    const { getInitData } = await import("../telegram");
    expect(getInitData()).toBe(INIT_DATA);
    fake.initData = "";
    expect(getInitData()).toBe(import.meta.env.VITE_DEV_INIT_DATA ?? "");
    vi.doUnmock("@twa-dev/sdk");
  });
});
