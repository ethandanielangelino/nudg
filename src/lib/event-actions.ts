import { createHmac, timingSafeEqual } from "node:crypto";

type ActionToken = { eventId: string; userId: string; exp: number };

function signingSecret() {
  const secret = process.env.CRON_SECRET || process.env.CHANNEL_CONFIG_ENCRYPTION_KEY;
  if (!secret) throw new Error("Event action signing secret is not configured.");
  return secret;
}

export function createEventActionToken(eventId: string, userId: string) {
  const payload = Buffer.from(JSON.stringify({ eventId, userId, exp: Date.now() + 90 * 24 * 60 * 60 * 1000 } satisfies ActionToken)).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyEventActionToken(token: string): ActionToken | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", signingSecret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ActionToken;
    if (!decoded.eventId || !decoded.userId || !Number.isFinite(decoded.exp) || decoded.exp < Date.now()) return null;
    return decoded;
  } catch { return null; }
}

function telegramSecret() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is required to secure Telegram event buttons.");
  return secret;
}

export function createTelegramEventAction(eventId: string, status: "attended" | "cancelled") {
  const actionCode = status === "attended" ? "a" : "c";
  const signature = createHmac("sha256", telegramSecret()).update(`${eventId}:${actionCode}`).digest("hex").slice(0, 22);
  return `e:${eventId}:${actionCode}:${signature}`;
}

export function verifyTelegramEventAction(value: string) {
  const match = value.match(/^e:([0-9a-f-]{36}):(a|c):([0-9a-f]{22})$/i);
  if (!match) return null;
  const [, eventId, actionCode, signature] = match;
  const expected = createHmac("sha256", telegramSecret()).update(`${eventId}:${actionCode}`).digest("hex").slice(0, 22);
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return { eventId, status: actionCode === "a" ? "attended" as const : "cancelled" as const };
}

export function createTelegramWebhookSecret() {
  return createHmac("sha256", telegramSecret()).update("nudg-telegram-webhook-v1").digest("hex");
}
