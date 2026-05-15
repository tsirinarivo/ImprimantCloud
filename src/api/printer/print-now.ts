import { sendPrintAndLog } from "../../lib/xprint";
import { PrintNowSchema } from "../../validation/printer";

// POST /api/printer/print-now — impression à la demande depuis l'UI
// Le caller doit fournir le contenu déjà formaté, ou ce handler peut
// déléguer à un builder selon le "kind".
export async function printNow(
  ownerId: string,
  body: unknown,
  contentBuilder: (kind: string, relatedId?: string) => Promise<string | null>,
) {
  const parsed = PrintNowSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const { kind, relatedId, copies } = parsed.data;

  const content = await contentBuilder(kind, relatedId);
  if (!content) {
    return { ok: false, errorMessage: `Impossible de construire le contenu pour kind="${kind}"` };
  }

  return sendPrintAndLog(ownerId, content, { kind, relatedId, copies });
}
