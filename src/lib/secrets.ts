import crypto from "node:crypto";
import fs from "node:fs";
import { DB_PATH } from "./db/schema";
import path from "node:path";

function encryptionKey(): Buffer {
  const configured = process.env.REPAID_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error("REPAID_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters");
    return Buffer.from(configured, "hex");
  }
  if (process.env.NODE_ENV === "production") throw new Error("REPAID_ENCRYPTION_KEY is required in production");
  const filename = DB_PATH + ".key";
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  try { fs.writeFileSync(filename, crypto.randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const key = fs.readFileSync(filename);
  if (key.length !== 32) throw new Error("Invalid local encryption key");
  return key;
}

export function encryptCredential(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v2.${iv.toString("base64")}.${ciphertext.toString("base64")}.${cipher.getAuthTag().toString("base64")}`;
}

export function decryptCredential(payload: string): string {
  const modern = payload.startsWith("v2.");
  const values = payload.split(".");
  if (modern) values.shift();
  if (values.length !== 3) throw new Error("قالب اطلاعات رمزگذاری‌شده معتبر نیست.");
  // Read-only compatibility for existing records; new records always use the private key.
  const key = modern ? encryptionKey() : crypto.scryptSync("repaid-local-secret", "repaid-salt", 32);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(values[0], "base64"));
    decipher.setAuthTag(Buffer.from(values[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(values[1], "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("بازیابی اطلاعات رمزگذاری‌شده ناموفق بود. کلید رمزگذاری را بررسی کنید.");
  }
}
