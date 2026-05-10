import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement symétrique AES-256-GCM pour le cookie de session Dougs.
 * - Clé : DOUGS_ENCRYPTION_KEY (env), 64 chars hex = 32 bytes.
 * - Format stocké : `iv:tag:ciphertext` en hex (sans dépendance externe,
 *   facile à débugger).
 *
 * Génération de clé locale :
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

function getKey(): Buffer {
  const k = process.env.DOUGS_ENCRYPTION_KEY;
  if (!k) {
    throw new Error(
      "DOUGS_ENCRYPTION_KEY manquante. Génère avec : node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  if (k.length !== 64) {
    throw new Error("DOUGS_ENCRYPTION_KEY doit faire 64 caractères hex (32 bytes).");
  }
  return Buffer.from(k, "hex");
}

export function encryptCookie(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptCookie(stored: string): string {
  const [ivHex, tagHex, ctHex] = stored.split(":");
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error("Format de cookie chiffré invalide (attendu iv:tag:ct).");
  }
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
