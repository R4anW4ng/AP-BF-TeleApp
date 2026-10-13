import { Api } from "node-telegram-bot-api";

export interface ApiCall {
  method: string;
  params: Record<string, unknown>;
}

type Reply = { ok: true; result: unknown } | { ok: false; error_code: number; description: string; parameters?: object };

/**
 * A stand-in for api.telegram.org, injected through the library's `fetch` option,
 * so tests exercise the real client (encoding, error classes) without the network.
 */
export function fakeTelegram(respond: (call: ApiCall) => Reply | undefined = () => undefined) {
  const calls: ApiCall[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = url.pathname.split("/").pop()!;
    const params: Record<string, unknown> = {};
    for (const [key, value] of new URLSearchParams(String(init?.body ?? ""))) {
      params[key] = /^[[{]/.test(value) ? JSON.parse(value) : value;
    }
    const call = { method, params };
    calls.push(call);
    const reply = respond(call) ?? { ok: true, result: defaultResult(method, params) };
    return new Response(JSON.stringify(reply), {
      status: reply.ok ? 200 : reply.error_code,
      headers: { "content-type": "application/json" },
    });
  };

  return {
    calls,
    fetch: fetchImpl,
    api: new Api("123456789:TEST-token_abcdefghijklmnopqrstuvwxyz", { fetch: fetchImpl, maxRetries: 0 }),
    sent: () => calls.filter((c) => c.method === "sendMessage"),
  };
}

function defaultResult(method: string, params: Record<string, unknown>) {
  if (method === "sendMessage") {
    return { message_id: 1, date: 0, chat: { id: Number(params.chat_id), type: "private" }, text: params.text };
  }
  return true;
}

export const blockedByUser = { ok: false as const, error_code: 403, description: "Forbidden: bot was blocked by the user" };
