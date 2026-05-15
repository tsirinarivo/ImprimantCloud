import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_ENV = "APP_ENCRYPTION_KEY";

let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const hex = process.env[KEY_ENV];
  // Fix A3-3 : valide longueur ET format hex — un hex invalide produit une clé nulle silencieuse
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${KEY_ENV} doit être une chaîne hex valide de 64 caractères (32 bytes). ` +
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

export const KEY_MASK = "••••••••";
