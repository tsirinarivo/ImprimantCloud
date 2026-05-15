import { PrismaClient } from "@prisma/client";
import { refreshPendingLogs } from "../../lib/xprint";
import { LogsQuerySchema } from "../../validation/printer";

const prisma = new PrismaClient();

// GET /api/printer/logs — liste paginée des logs d'impression
//
// UI conseillée :
//   Colonnes : Date | Type | Référence | Statut | Copies | Erreur
//   Filtres  : status (pending/printed/failed), kind
//   Badge    : compteur de "pending" avec bouton "Rafraîchir"
//   Actions  : bouton ré-imprimer (appelle /api/printer/print-now)
export async function getLogs(ownerId: string, query: unknown) {
  const parsed = LogsQuerySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const { page, perPage, status, kind } = parsed.data;

  const where = {
    ownerId,
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
  };

  const [logs, total, pendingCount] = await Promise.all([
    prisma.printLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.printLog.count({ where }),
    prisma.printLog.count({ where: { ownerId, status: "pending" } }),
  ]);

  return {
    ok: true,
    data: logs,
    meta: {
      total,
      page,
      perPage,
      pageCount: Math.ceil(total / perPage),
      pendingCount,
    },
  };
}

// POST /api/printer/logs/refresh — re-poll tous les jobs pending
export async function refreshLogs(ownerId: string) {
  const result = await refreshPendingLogs(ownerId);
  return { ok: true, ...result };
}
