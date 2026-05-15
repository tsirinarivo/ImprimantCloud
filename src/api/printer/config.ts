import { PrismaClient } from "@prisma/client";
import { encrypt } from "../../lib/encrypt";
import { invalidateCfgCache } from "../../lib/xprint";
import { PrinterConfigSchema } from "../../validation/printer";

const prisma = new PrismaClient();

// GET /api/printer/config — lecture de la config (sans la clé en clair)
export async function getConfig(ownerId: string) {
  const cfg = await prisma.printerConfig.findUnique({ where: { ownerId } });
  if (!cfg) return null;

  return {
    ...cfg,
    key: cfg.key ? "••••••••" : null, // ne jamais renvoyer la clé
  };
}

// PUT /api/printer/config — écriture avec chiffrement de la clé
export async function updateConfig(ownerId: string, body: unknown) {
  const parsed = PrinterConfigSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;

  // Chiffre la UserKEY avant persistance (correctif #2)
  let encryptedKey: string | undefined;
  if (data.key) {
    try {
      encryptedKey = encrypt(data.key);
    } catch (e) {
      return { ok: false, errors: { key: ["Chiffrement impossible — vérifier APP_ENCRYPTION_KEY"] } };
    }
  }

  await prisma.printerConfig.upsert({
    where: { ownerId },
    create: {
      ownerId,
      ...data,
      key: encryptedKey ?? data.key,
    },
    update: {
      ...data,
      ...(encryptedKey ? { key: encryptedKey } : {}),
    },
  });

  // Invalider le cache immédiatement après mise à jour
  invalidateCfgCache(ownerId);

  return { ok: true };
}
