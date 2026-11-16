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
