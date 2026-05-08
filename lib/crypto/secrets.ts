import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement AES-256-GCM pour les secrets stockés en base (refresh
 * tokens Google, etc.). La clé maîtresse vient de `SECRETS_ENC_KEY` —
 * 32 bytes encodés base64. À générer avec :
 *
 *   openssl rand -base64 32
 *
 * Format encodé : `v1:<iv>:<authTag>:<ciphertext>` (chaque partie en
 * base64url). Le préfixe de version permet une rotation propre du
 * format si on change d'algo plus tard.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;
  const raw = process.env.SECRETS_ENC_KEY;
  if (!raw) {
    throw new Error(
      "SECRETS_ENC_KEY manquant. Génère-le avec `openssl rand -base64 32` puis ajoute-le à .env.local",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`SECRETS_ENC_KEY doit faire 32 bytes (base64). Reçu : ${buf.length} bytes.`);
  }
  _key = buf;
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(blob: string): string {
  const [version, ivPart, tagPart, encPart] = blob.split(":");
  if (version !== "v1" || !ivPart || !tagPart || !encPart) {
    throw new Error("Format de secret invalide.");
  }
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const enc = Buffer.from(encPart, "base64url");
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
