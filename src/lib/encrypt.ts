import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Correctif #2 : chiffrement AES-256-GCM pour stocker les UserKEY xpyun
// Variable d'environnement : APP_ENCRYPTION_KEY = 64 chars hex (32 bytes)
// Générer : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const ALGO = "aes-256-gcm";
const KEY_ENV = "APP_ENCRYPTION_KEY";

// Correctif #10 : clé parsée une seule fois au lieu d'être ré-allouée à chaque appel
let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const hex = process.env[KEY_ENV];
  if (!hex || hex.length !== 64) {
    throw new Error(
      `${KEY_ENV} doit être une chaîne hex de 64 caractères (32 bytes). ` +
        `Générer avec : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  _cachedKey = Buffer.from(hex, "hex");
  return _cachedKey;
}

// Chiffre une chaîne et retourne un blob base64 : iv(12) + tag(16) + ciphertext
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

// Déchiffre un blob base64 produit par encrypt()
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < 29) throw new Error("Ciphertext trop court — format invalide");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// Valeur renvoyée par getConfig() pour masquer la clé en lecture
export const KEY_MASK = "••••••••";
