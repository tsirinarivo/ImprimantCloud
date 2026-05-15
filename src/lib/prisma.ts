import { PrismaClient } from "@prisma/client";

// Correctif #2 : singleton partagé — évite d'ouvrir N pools de connexions.
// Le pattern globalThis est nécessaire en Next.js (hot-reload en dev réinitialise
// les variables de module, ce qui crée une nouvelle instance à chaque rechargement).
const g = globalThis as unknown as { _xprintPrisma?: PrismaClient };

export const prisma = g._xprintPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  g._xprintPrisma = prisma;
}
