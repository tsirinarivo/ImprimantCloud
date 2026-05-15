import { prisma } from "../../lib/prisma";
import { encrypt, KEY_MASK } from "../../lib/encrypt";
import { invalidateCfgCache } from "../../lib/xprint";
import { PrinterConfigSchema } from "../../validation/printer";

// GET /api/printer/config — lecture de la config (clé masquée)
export async function getConfig(ownerId: string) {
  const cfg = await prisma.printerConfig.findUnique({ where: { ownerId } });
  if (!cfg) return null;

  return {
    ...cfg,
    key: cfg.key ? KEY_MASK : null, // ne jamais renvoyer la clé en clair
  };
}

// PUT /api/printer/config — écriture avec chiffrement de la clé
export async function updateConfig(ownerId: string, body: unknown) {
  const parsed = PrinterConfigSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  // Correctif #1 : séparer la clé du reste pour éviter de re-chiffrer la valeur masquée.
  // Si le frontend renvoie KEY_MASK (valeur retournée par getConfig), on ne touche pas
  // à la clé existante en DB. Sinon on chiffre la nouvelle valeur.
  const { key: rawKey, ...dataWithoutKey } = parsed.data;
  const isNewKey = rawKey !== undefined && rawKey !== KEY_MASK;

  let encryptedKey: string | undefined;
  if (isNewKey) {
    try {
      encryptedKey = encrypt(rawKey!);
    } catch {
      return { ok: false, errors: { key: ["Chiffrement impossible — vérifier APP_ENCRYPTION_KEY"] } };
    }
  }

  await prisma.printerConfig.upsert({
    where: { ownerId },
    create: {
      ownerId,
      ...dataWithoutKey,
      key: encryptedKey ?? null,
    },
    update: {
      ...dataWithoutKey,
      // Correctif #1 : key omise de l'update si elle n'a pas changé → Prisma conserve l'existante
      ...(encryptedKey ? { key: encryptedKey } : {}),
    },
  });

  invalidateCfgCache(ownerId);
  return { ok: true };
}
