import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InitDataError, signInitData, validateInitData } from "../src/lib/telegramInitData.js";

const TOKEN = "123456789:TEST-token_abcdefghijklmnopqrstuvwxyz";
const NOW = new Date("2026-10-20T03:00:00Z");
const opts = { maxAgeSeconds: 3600, now: NOW };
const user = { id: 424242, first_name: "Grace", last_name: "Tan", username: "gracet", language_code: "en" };

/** Independent implementation, written straight from the Telegram docs. */
function referenceSign(fields: Record<string, string>, botToken: string): string {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InitDataError);
    expect((e as InitDataError).code).toBe(code);
    return;
  }
  throw new Error(`expected InitDataError ${code}`);
}

describe("validateInitData", () => {
  const authDate = String(Math.floor(NOW.getTime() / 1000) - 60);
  const fields = {
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify(user),
    auth_date: authDate,
    // Newer clients also send an Ed25519 `signature`; it is part of the HMAC check string.
    signature: "abc123_signature-value",
  };

  it("accepts initData signed per the Telegram spec", () => {
    const result = validateInitData(referenceSign(fields, TOKEN), TOKEN, opts);
    expect(result.user).toMatchObject({ id: 424242, first_name: "Grace" });
    expect(result.authDate.getTime()).toBe(Number(authDate) * 1000);
    expect(result.queryId).toBe(fields.query_id);
  });

  it("produces the same signature as the reference implementation", () => {
    const ours = new URLSearchParams(signInitData({ user, authDate: new Date(Number(authDate) * 1000) }, TOKEN));
    const reference = new URLSearchParams(referenceSign({ auth_date: authDate, user: JSON.stringify(user) }, TOKEN));
    expect(ours.get("hash")).toBe(reference.get("hash"));
  });

  it("rejects a tampered user (e.g. someone swapping in another Telegram ID)", () => {
    const params = new URLSearchParams(referenceSign(fields, TOKEN));
    params.set("user", JSON.stringify({ ...user, id: 1000 }));
    expectCode(() => validateInitData(params.toString(), TOKEN, opts), "BAD_SIGNATURE");
  });

  it("rejects data signed by a different bot", () => {
    const other = referenceSign(fields, "987654321:OTHER-token_abcdefghijklmnopqrstuvwx");
    expectCode(() => validateInitData(other, TOKEN, opts), "BAD_SIGNATURE");
  });

  it("rejects an extra unsigned field", () => {
    const tampered = `${referenceSign(fields, TOKEN)}&start_param=admin`;
    expectCode(() => validateInitData(tampered, TOKEN, opts), "BAD_SIGNATURE");
  });

  it("rejects expired data", () => {
    const old = referenceSign({ ...fields, auth_date: String(Math.floor(NOW.getTime() / 1000) - 3601) }, TOKEN);
    expectCode(() => validateInitData(old, TOKEN, opts), "EXPIRED");
  });

  it("rejects auth_date in the future", () => {
    const future = referenceSign({ ...fields, auth_date: String(Math.floor(NOW.getTime() / 1000) + 600) }, TOKEN);
    expectCode(() => validateInitData(future, TOKEN, opts), "MALFORMED");
  });

  it("rejects missing or malformed hash", () => {
    const params = new URLSearchParams(referenceSign(fields, TOKEN));
    params.delete("hash");
    expectCode(() => validateInitData(params.toString(), TOKEN, opts), "MALFORMED");
    params.set("hash", "not-hex");
    expectCode(() => validateInitData(params.toString(), TOKEN, opts), "MALFORMED");
  });

  it("rejects duplicate keys", () => {
    const dup = `${referenceSign(fields, TOKEN)}&auth_date=${authDate}`;
    expectCode(() => validateInitData(dup, TOKEN, opts), "MALFORMED");
  });

  it("rejects a validly signed payload without a user", () => {
    const { user: _u, ...noUser } = fields;
    expectCode(() => validateInitData(referenceSign(noUser, TOKEN), TOKEN, opts), "NO_USER");
  });

  it("rejects empty input", () => {
    expectCode(() => validateInitData("", TOKEN, opts), "MALFORMED");
  });
});
