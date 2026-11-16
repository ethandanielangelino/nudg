import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";

function getEncryptionKey() {
  const encodedKey = process.env.CHANNEL_CONFIG_ENCRYPTION_KEY;
  if (!encodedKey) throw new Error("CHANNEL_CONFIG_ENCRYPTION_KEY is not configured.");

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("CHANNEL_CONFIG_ENCRYPTION_KEY must be a base64 encoded 32-byte key.");
  }
  return key;
}

export function encryptChannelConfig(config: Record<string, string>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(config), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

export function decryptChannelConfig(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const config = value as Record<string, unknown>;

  // Read older, unencrypted rows so existing settings can be migrated on save.
  if (typeof config.encrypted !== "string" || !config.encrypted.startsWith(ENCRYPTED_PREFIX)) {
    return Object.fromEntries(
      Object.entries(config).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  }

  const packed = Buffer.from(config.encrypted.slice(ENCRYPTED_PREFIX.length), "base64");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
